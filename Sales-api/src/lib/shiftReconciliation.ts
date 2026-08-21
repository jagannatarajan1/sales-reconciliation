import { Shift, ShiftReconciliationStatus } from "@prisma/client";
import { prisma } from "./prisma.js";
import { dateOnly, isShiftEntryEnabled } from "./activeDate.js";
import { computeShiftTotals } from "./dailyTotals.js";
import { getShiftXTotal, getZReportTotal } from "./tillReportIngest.js";
import { isWithinTolerance, VARIANCE_TOLERANCE } from "./variance.js";
import { sendShiftVarianceEmail, sendDayXvsZEmail } from "./commitEmail.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function statusFor(difference: number | null): ShiftReconciliationStatus {
  if (difference == null) return ShiftReconciliationStatus.PENDING;
  return isWithinTolerance(difference) ? ShiftReconciliationStatus.OK : ShiftReconciliationStatus.VARIANCE;
}

/**
 * Refreshes a shift's TILL and STAFF figures and recomputes every derived
 * field. Deliberately NEVER touches adminEditedTotal/adminEditedById/
 * adminEditedByName/adminEditedAt/adminEditReason — those are exclusively
 * written by applyAdminEdit below, so a background re-evaluation (poller,
 * staff re-saving their figures) can never silently discard an admin's
 * correction.
 */
export async function evaluateShift(date: Date, shift: Shift) {
  const d = dateOnly(date);

  const [existing, { total: originalTotal, count: xReportCount }, staffTotals, summaryRow] = await Promise.all([
    prisma.shiftReconciliation.findUnique({ where: { date_shift: { date: d, shift } } }),
    getShiftXTotal(d, shift),
    computeShiftTotals(d, shift),
    prisma.dailySummary.findUnique({ where: { date_shift: { date: d, shift } } }),
  ]);

  const hasEntries = summaryRow != null;
  const staffEnteredTotal = hasEntries ? round2(staffTotals.summaryTotal) : null;
  const staffEnteredById = summaryRow?.lastEditedByUserId ?? null;
  const staffEnteredByName = summaryRow?.lastEditedByName ?? null;
  const staffEnteredAt = summaryRow?.updatedAt ?? null;

  // Admin fields are read-only here — carried forward from whatever already
  // exists, never derived or reset.
  const adminEditedTotal = existing?.adminEditedTotal != null ? Number(existing.adminEditedTotal) : null;

  const finalTotal = adminEditedTotal ?? staffEnteredTotal ?? (originalTotal != null ? round2(originalTotal) : null);

  const originalDifference =
    originalTotal != null && staffEnteredTotal != null ? round2(originalTotal - staffEnteredTotal) : null;
  const finalDifference =
    originalTotal != null && finalTotal != null ? round2(originalTotal - finalTotal) : null;

  // PENDING whenever the till hasn't reported yet or nobody has entered
  // anything for this shift — never alert on a shift that simply hasn't
  // happened yet (the X-Report for a 15:00 cutoff can land before staff have
  // had a chance to enter their figures).
  const gated = originalTotal == null || !hasEntries;
  const originalStatus = gated ? ShiftReconciliationStatus.PENDING : statusFor(originalDifference);
  const finalStatus = gated
    ? ShiftReconciliationStatus.PENDING
    : !isWithinTolerance(finalDifference ?? 0)
      ? ShiftReconciliationStatus.VARIANCE
      : adminEditedTotal != null
        ? ShiftReconciliationStatus.RESOLVED
        : ShiftReconciliationStatus.OK;

  const data = {
    originalTotal,
    xReportCount,
    staffEnteredTotal,
    staffEnteredById,
    staffEnteredByName,
    staffEnteredAt,
    finalTotal,
    originalDifference,
    finalDifference,
    originalStatus,
    finalStatus,
    hasEntries,
    // Deliberately absent, exactly like the adminEdited* columns above:
    // isShiftCommitted / shiftCommittedBy* / shiftStaffNotes are written only
    // by POST /Summary/shift-commit. Including them here would let a poller
    // cycle or a staff re-save silently un-commit a shift.
  };

  return prisma.shiftReconciliation.upsert({
    where: { date_shift: { date: d, shift } },
    create: { date: d, shift, ...data },
    update: data,
  });
}

/**
 * The ONLY function that writes the admin columns. Recomputes the derived
 * fields from the new adminEditedTotal, then refreshes the day-level X-vs-Z
 * check so a correction that resolves the shift also resolves the day
 * without a second alert.
 */
export async function applyAdminEdit(
  date: Date,
  shift: Shift,
  input: { total: number; reason: string; userId: number; userName: string | null }
) {
  const d = dateOnly(date);

  let row = await prisma.shiftReconciliation.findUnique({ where: { date_shift: { date: d, shift } } });
  if (!row) row = await evaluateShift(d, shift);

  const originalTotal = row.originalTotal != null ? Number(row.originalTotal) : null;
  const adminEditedTotal = round2(input.total);
  const finalTotal = adminEditedTotal;
  const finalDifference = originalTotal != null ? round2(originalTotal - finalTotal) : null;

  const gated = originalTotal == null || !row.hasEntries;
  const finalStatus = gated
    ? ShiftReconciliationStatus.PENDING
    : !isWithinTolerance(finalDifference ?? 0)
      ? ShiftReconciliationStatus.VARIANCE
      : ShiftReconciliationStatus.RESOLVED;

  const updated = await prisma.shiftReconciliation.update({
    where: { date_shift: { date: d, shift } },
    data: {
      adminEditedTotal,
      adminEditedById: input.userId,
      adminEditedByName: input.userName,
      adminEditedAt: new Date(),
      adminEditReason: input.reason,
      finalTotal,
      finalDifference,
      finalStatus,
    },
  });

  await evaluateDay(d);
  return updated;
}

/** Marks a shift RESOLVED with a note, without changing any total. */
export async function resolveShift(date: Date, shift: Shift, notes: string | null) {
  const d = dateOnly(date);
  return prisma.shiftReconciliation.update({
    where: { date_shift: { date: d, shift } },
    data: { finalStatus: ShiftReconciliationStatus.RESOLVED, adminEditReason: notes ?? undefined },
  });
}

/**
 * End-of-day X_day + X_night vs Z, using FINAL (admin-approved where
 * present) shift totals — never the raw till totals — so an admin
 * correction that resolves a shift variance also resolves this check
 * instead of generating a second, contradictory alert.
 */
export async function evaluateDay(date: Date) {
  const d = dateOnly(date);

  const [dayRow, nightRow, zReportTotal] = await Promise.all([
    prisma.shiftReconciliation.findUnique({ where: { date_shift: { date: d, shift: Shift.DAY } } }),
    prisma.shiftReconciliation.findUnique({ where: { date_shift: { date: d, shift: Shift.NIGHT } } }),
    getZReportTotal(d),
  ]);

  const xFinalDayTotal = dayRow?.finalTotal != null ? Number(dayRow.finalTotal) : null;
  const xFinalNightTotal = nightRow?.finalTotal != null ? Number(nightRow.finalTotal) : null;
  const xFinalSumTotal =
    xFinalDayTotal != null && xFinalNightTotal != null ? round2(xFinalDayTotal + xFinalNightTotal) : null;
  const xVsZDifference =
    xFinalSumTotal != null && zReportTotal != null ? round2(xFinalSumTotal - zReportTotal) : null;

  await prisma.reconciliationRecord.upsert({
    where: { date: d },
    create: { date: d, xFinalDayTotal, xFinalNightTotal, xFinalSumTotal, xVsZDifference },
    update: { xFinalDayTotal, xFinalNightTotal, xFinalSumTotal, xVsZDifference },
  });

  return { xFinalDayTotal, xFinalNightTotal, xFinalSumTotal, xVsZDifference, zReportTotal };
}

const SHIFT_LABEL: Record<Shift, string> = { FULL_DAY: "Full Day", DAY: "Day", NIGHT: "Night" };

/**
 * evaluateShift + the notification decision. Split from evaluateShift so
 * the fire-and-forget callers on every save route (PUT /Summary, POST
 * /Deduction, etc.) share one entry point with the poller — nobody should
 * ever call evaluateShift directly and forget the notification half.
 *
 * No-ops entirely while SHIFT_ENTRY_ENABLED is off: evaluating a "shift"
 * variance is meaningless before staff are actually entering shift-scoped
 * figures, and would otherwise start emailing the admin about the single
 * legacy FULL_DAY bucket the moment this code shipped, long before the
 * feature's real cutover date.
 */
export async function evaluateAndNotify(date: Date, shift: Shift): Promise<void> {
  if (!isShiftEntryEnabled() || shift === Shift.FULL_DAY) return;

  const row = await evaluateShift(date, shift);

  if (row.finalStatus !== ShiftReconciliationStatus.VARIANCE) {
    // Back in (or never left) tolerance — clear any pending notification
    // state so a later, genuinely new variance alerts again instead of
    // being suppressed by a stale notifiedDifference.
    if (row.notifiedAt != null) {
      await prisma.shiftReconciliation.update({
        where: { shiftReconciliationId: row.shiftReconciliationId },
        data: { notifiedAt: null, notifiedDifference: null },
      });
    }
  } else {
    const currentDifference = Number(row.finalDifference ?? 0);
    const previouslyNotified = row.notifiedDifference != null ? Number(row.notifiedDifference) : null;
    const alreadyNotifiedForThis =
      previouslyNotified != null && Math.abs(currentDifference - previouslyNotified) <= VARIANCE_TOLERANCE;

    if (!alreadyNotifiedForThis) {
      await sendShiftVarianceEmail({
        dateStr: date.toISOString().split("T")[0],
        shift: shift === Shift.NIGHT ? "NIGHT" : "DAY",
        shiftLabel: SHIFT_LABEL[shift],
        enteredTotal: Number(row.staffEnteredTotal ?? 0),
        xReportTotal: Number(row.originalTotal ?? 0),
        difference: currentDifference,
        xReportCount: row.xReportCount,
      });
      await prisma.shiftReconciliation.update({
        where: { shiftReconciliationId: row.shiftReconciliationId },
        data: { notifiedAt: new Date(), notifiedDifference: currentDifference },
      });
    }
  }

  await evaluateAndNotifyDay(date);
}

async function evaluateAndNotifyDay(date: Date): Promise<void> {
  const d = dateOnly(date);
  const result = await evaluateDay(d);
  const record = await prisma.reconciliationRecord.findUnique({ where: { date: d } });
  if (!record) return;

  const inTolerance = result.xVsZDifference == null || isWithinTolerance(result.xVsZDifference);

  if (inTolerance) {
    if (record.zNotifiedAt != null) {
      await prisma.reconciliationRecord.update({
        where: { date: d },
        data: { zNotifiedAt: null, zNotifiedDifference: null },
      });
    }
    return;
  }

  const currentDifference = Number(result.xVsZDifference);
  const previouslyNotified = record.zNotifiedDifference != null ? Number(record.zNotifiedDifference) : null;
  const alreadyNotifiedForThis =
    previouslyNotified != null && Math.abs(currentDifference - previouslyNotified) <= VARIANCE_TOLERANCE;
  if (alreadyNotifiedForThis) return;

  await sendDayXvsZEmail({
    dateStr: d.toISOString().split("T")[0],
    xDay: result.xFinalDayTotal ?? 0,
    xNight: result.xFinalNightTotal ?? 0,
    xSum: result.xFinalSumTotal ?? 0,
    zReportTotal: result.zReportTotal ?? 0,
    difference: currentDifference,
  });
  await prisma.reconciliationRecord.update({
    where: { date: d },
    data: { zNotifiedAt: new Date(), zNotifiedDifference: currentDifference },
  });
}

export interface ShiftBreakdownDto {
  shift: Shift;
  originalTotal: number | null;
  xReportCount: number;
  staffEnteredTotal: number | null;
  staffEnteredByName: string | null;
  staffEnteredAt: Date | null;
  adminEditedTotal: number | null;
  adminEditedByName: string | null;
  adminEditedAt: Date | null;
  adminEditReason: string | null;
  finalTotal: number | null;
  originalDifference: number | null;
  finalDifference: number | null;
  originalStatus: ShiftReconciliationStatus;
  finalStatus: ShiftReconciliationStatus;
  hasEntries: boolean;
}

export interface XvsZDto {
  xDay: number | null;
  xNight: number | null;
  xSum: number | null;
  zReportTotal: number | null;
  difference: number;
  inTolerance: boolean;
}

// Shared read model for "what does this date's shift reconciliation look
// like right now" — backs both the admin pending queue (adminReconciliation.
// routes.ts) and the staff-facing Commit readiness panel
// (GET /api/Summary/shift-status), so the two surfaces can never disagree
// about what a shift's status is.
export async function getShiftBreakdown(
  date: Date
): Promise<{ shifts: ShiftBreakdownDto[]; xVsZ: XvsZDto | null }> {
  const d = dateOnly(date);

  // Refresh on every view rather than only reading whatever is already on
  // file. TillReport ingestion is unconditional (runs regardless of
  // SHIFT_ENTRY_ENABLED — see tillPoller.ts), but evaluateShift/evaluateDay
  // are otherwise only invoked reactively (the poller's rolling 3-day
  // window, or a staff save while the flag is on) — a date outside that
  // window whose X-Report has already been ingested would otherwise show
  // nothing here even though the report is sitting right there in
  // TillReport. evaluateShift is a pure local recomputation (no Gmail call)
  // and never touches the admin-edit columns, so it's safe and cheap to
  // rerun on every read.
  const [dayRow, nightRow] = await Promise.all([evaluateShift(d, Shift.DAY), evaluateShift(d, Shift.NIGHT)]);
  // Read straight off evaluateDay's own return value rather than re-fetching
  // ReconciliationRecord.zReportTotal — that column is a separate, legacy
  // field written only by the day-level commit/submit flow (POST
  // /Summary/commit, POST /admin/reconciliation/submit) and can disagree
  // with the Z-Report value evaluateDay actually just compared xSum
  // against, producing a zReportTotal that doesn't reconcile with the
  // displayed difference.
  const dayResult = await evaluateDay(d);

  const shifts: ShiftBreakdownDto[] = [dayRow, nightRow].map((row) => ({
    shift: row.shift,
    originalTotal: row.originalTotal != null ? Number(row.originalTotal) : null,
    xReportCount: row.xReportCount,
    staffEnteredTotal: row.staffEnteredTotal != null ? Number(row.staffEnteredTotal) : null,
    staffEnteredByName: row.staffEnteredByName,
    staffEnteredAt: row.staffEnteredAt,
    adminEditedTotal: row.adminEditedTotal != null ? Number(row.adminEditedTotal) : null,
    adminEditedByName: row.adminEditedByName,
    adminEditedAt: row.adminEditedAt,
    adminEditReason: row.adminEditReason,
    finalTotal: row.finalTotal != null ? Number(row.finalTotal) : null,
    originalDifference: row.originalDifference != null ? Number(row.originalDifference) : null,
    finalDifference: row.finalDifference != null ? Number(row.finalDifference) : null,
    originalStatus: row.originalStatus,
    finalStatus: row.finalStatus,
    hasEntries: row.hasEntries,
  }));

  const xVsZ: XvsZDto | null =
    dayResult.xVsZDifference != null
      ? {
          xDay: dayResult.xFinalDayTotal,
          xNight: dayResult.xFinalNightTotal,
          xSum: dayResult.xFinalSumTotal,
          zReportTotal: dayResult.zReportTotal,
          difference: dayResult.xVsZDifference,
          inTolerance: isWithinTolerance(dayResult.xVsZDifference),
        }
      : null;

  return { shifts, xVsZ };
}

// Staff-safe view of a shift's reconciliation chain — everything a staff
// member is allowed to know about their own shift (original till total,
// what was entered and by whom, any admin adjustment amount, the final
// approved value, and status), but never the admin's identity, their edit
// reason, or the reprint count. Centralized here (not inline in a route
// handler) because it is derived directly from ShiftBreakdownDto and must
// stay in lockstep with it.
export type StaffShiftDto = Omit<
  ShiftBreakdownDto,
  "xReportCount" | "adminEditedByName" | "adminEditedAt" | "adminEditReason"
>;

export function toStaffShiftDto(dto: ShiftBreakdownDto): StaffShiftDto {
  const { xReportCount: _xReportCount, adminEditedByName: _adminEditedByName, adminEditedAt: _adminEditedAt, adminEditReason: _adminEditReason, ...rest } = dto;
  return rest;
}

// What a staff member may see of a shift they are NOT working: whether it is
// OK, in variance, or still pending — enough to hand over sensibly — but none
// of its money. Handover context without exposing another shift's figures.
export type StaffOtherShiftDto = Pick<
  StaffShiftDto,
  "shift" | "originalStatus" | "finalStatus" | "hasEntries"
>;

export function toStaffOtherShiftDto(dto: ShiftBreakdownDto): StaffOtherShiftDto {
  return {
    shift: dto.shift,
    originalStatus: dto.originalStatus,
    finalStatus: dto.finalStatus,
    hasEntries: dto.hasEntries,
  };
}

export type StaffShiftViewDto =
  | (StaffShiftDto & { isOwnShift: true })
  | (StaffOtherShiftDto & { isOwnShift: false });

// Staff-safe equivalent of getShiftBreakdown — same read model, but the
// Z-Report comparison is not merely omitted from the DTO type, it is never
// computed into the response at all: there is no `xVsZ` key, not even null.
// Backs GET /Summary/shift-status, which any authenticated staff member can
// call directly.
//
// `activeShift` scopes the money: the caller's own shift comes back in full,
// every other shift is reduced to its status. Passing FULL_DAY (or omitting
// it) returns everything, which is correct while SHIFT_ENTRY_ENABLED is off —
// there is only one shift then, and redacting it would blank the page.
export async function getStaffShiftBreakdown(
  date: Date,
  activeShift?: Shift
): Promise<{ shifts: StaffShiftViewDto[] }> {
  const { shifts } = await getShiftBreakdown(date);

  const scoped = activeShift != null && activeShift !== Shift.FULL_DAY;

  return {
    shifts: shifts.map((row) =>
      !scoped || row.shift === activeShift
        ? { ...toStaffShiftDto(row), isOwnShift: true as const }
        : { ...toStaffOtherShiftDto(row), isOwnShift: false as const }
    ),
  };
}

export interface DateStatusDto {
  date: string; // yyyy-mm-dd
  dayStatus: ShiftReconciliationStatus;
  nightStatus: ShiftReconciliationStatus;
  // Only ever PENDING/OK/VARIANCE in practice — there is no day-level
  // "resolve" action for xVsZDifference (only per-shift resolveShift
  // exists), so RESOLVED is never assigned here despite the shared type.
  zStatus: ShiftReconciliationStatus;
}

// Per-date DAY/NIGHT/Z status rollup for a date range. Backs both the admin
// Calendar tab's month grid (full, via GET /admin/reconciliation/calendar)
// and the staff shift-review calendar (stripped by toStaffStatusDto, via
// GET /Summary/shift-calendar) — one query, one source of truth, so the two
// dot-grids can never disagree about a shift's status. A date only appears
// if it has at least one ShiftReconciliation row or ReconciliationRecord;
// a missing shift within an included date defaults to PENDING.
export async function getStatusCalendar(fromDate: Date, toDate: Date): Promise<DateStatusDto[]> {
  const from = dateOnly(fromDate);
  const to = dateOnly(toDate);

  const [shiftRows, records] = await Promise.all([
    prisma.shiftReconciliation.findMany({
      where: { date: { gte: from, lte: to }, shift: { in: [Shift.DAY, Shift.NIGHT] } },
    }),
    prisma.reconciliationRecord.findMany({ where: { date: { gte: from, lte: to } } }),
  ]);

  const shiftByDate = new Map<string, Partial<Record<"DAY" | "NIGHT", ShiftReconciliationStatus>>>();
  for (const row of shiftRows) {
    const key = row.date.toISOString().split("T")[0];
    const entry = shiftByDate.get(key) ?? {};
    entry[row.shift as "DAY" | "NIGHT"] = row.finalStatus;
    shiftByDate.set(key, entry);
  }
  const recordByDate = new Map(records.map((r) => [r.date.toISOString().split("T")[0], r]));

  const dates = new Set<string>([...shiftByDate.keys(), ...recordByDate.keys()]);
  return Array.from(dates)
    .sort()
    .map((date) => {
      const shifts = shiftByDate.get(date) ?? {};
      const record = recordByDate.get(date);
      const zStatus =
        record?.xVsZDifference == null
          ? ShiftReconciliationStatus.PENDING
          : isWithinTolerance(Number(record.xVsZDifference))
            ? ShiftReconciliationStatus.OK
            : ShiftReconciliationStatus.VARIANCE;
      return {
        date,
        dayStatus: shifts.DAY ?? ShiftReconciliationStatus.PENDING,
        nightStatus: shifts.NIGHT ?? ShiftReconciliationStatus.PENDING,
        zStatus,
      };
    });
}

export function toStaffStatusDto(dto: DateStatusDto): Omit<DateStatusDto, "zStatus"> {
  const { zStatus: _zStatus, ...rest } = dto;
  return rest;
}
