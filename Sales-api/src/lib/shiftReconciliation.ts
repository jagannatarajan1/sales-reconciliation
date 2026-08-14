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

  const [rows, record] = await Promise.all([
    prisma.shiftReconciliation.findMany({ where: { date: d, shift: { in: [Shift.DAY, Shift.NIGHT] } } }),
    prisma.reconciliationRecord.findUnique({ where: { date: d } }),
  ]);

  const shifts: ShiftBreakdownDto[] = rows.map((row) => ({
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
    record?.xVsZDifference != null
      ? {
          xDay: record.xFinalDayTotal != null ? Number(record.xFinalDayTotal) : null,
          xNight: record.xFinalNightTotal != null ? Number(record.xFinalNightTotal) : null,
          xSum: record.xFinalSumTotal != null ? Number(record.xFinalSumTotal) : null,
          zReportTotal: record.zReportTotal != null ? Number(record.zReportTotal) : null,
          difference: Number(record.xVsZDifference),
          inTolerance: isWithinTolerance(Number(record.xVsZDifference)),
        }
      : null;

  return { shifts, xVsZ };
}
