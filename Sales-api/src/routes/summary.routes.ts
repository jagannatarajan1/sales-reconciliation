import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveDate, getActiveContext, dateOnly, shiftCutoffMinutes } from "../lib/activeDate.js";
import { computeDailyTotals } from "../lib/dailyTotals.js";
import { parseDepartmentTotal } from "../lib/departmentTotal.js";
import { sendCommitNotificationEmail } from "../lib/commitEmail.js";
import * as gmailService from "../services/gmail.service.js";
import { getShiftXTotal } from "../lib/tillReportIngest.js";
import {
  evaluateAndNotify,
  evaluateDay,
  getStaffShiftBreakdown,
  getStatusCalendar,
  toStaffStatusDto,
} from "../lib/shiftReconciliation.js";
import { writeAuditLog } from "../lib/auditLog.js";
import { blockIfLocked, blockIfPriorShiftPending, getLockState, getPriorShiftGate, isPriorShiftPending } from "../lib/entryLock.js";
import { computeShiftTotals } from "../lib/dailyTotals.js";
import { getStaffOwnShiftReport } from "../lib/staffTillReportView.js";
import { isShiftClosed } from "../lib/storeClosure.js";
import { Shift } from "@prisma/client";

export const summaryRouter = Router();

const EDITABLE_KEYS = [
  "cashback",
  "paypointPayout",
  "instantLotteryPayout",
  "lotteryPayout",
  "newsVoucher",
  "ddPoint",
  "lotteryValue",
  "paypointValue",
] as const;

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Shown verbatim by the Commit page when the day's Z-Report has not arrived.
export const Z_REPORT_MISSING_MESSAGE =
  "Commit cannot be completed because the Z Report is not available for the selected date.";

summaryRouter.get("/today", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const { date, shift, shiftSource } = await getActiveContext();
  const [record, totals, reconciliation, shiftX, lockState, priorShiftGate, closed] = await Promise.all([
    prisma.dailySummary.findUnique({ where: { date_shift: { date, shift } }, include: { creditCardEntries: true } }),
    computeDailyTotals(date),
    prisma.reconciliationRecord.findUnique({ where: { date } }),
    // Never allowed to fail the whole endpoint: Summary must keep loading
    // before any X-Report for the shift has arrived. While
    // SHIFT_ENTRY_ENABLED is off, shift is always FULL_DAY here, and
    // TillReport rows are never classified FULL_DAY (till reports are always
    // DAY/NIGHT) — so this naturally comes back empty rather than needing a
    // separate on/off branch.
    getShiftXTotal(date, shift).catch(() => ({ total: null, count: 0 })),
    getLockState(date, shift),
    // NIGHT waiting on DAY's staff commit — false for DAY/FULL_DAY. A
    // separate concept from lockState above: this is a pre-condition ("has
    // Night's turn come up yet"), not a post-hoc "already submitted" lock.
    getPriorShiftGate(date, shift),
    // Whether the ACTIVE shift itself is marked Closed (holiday etc.) — a
    // third, independent state from the two above: not "already submitted"
    // and not "waiting on Day", but "this shift was never expected to
    // happen". Evaluated live on every request, same as every other lock
    // check here, so reopening a closure "just works" with no extra code.
    isShiftClosed(date, shift),
  ]);

  // Z-Report data (department total / variance) is intentionally never
  // looked up or returned here — this endpoint is reachable by any
  // authenticated staff member, and staff must never see Z-Report figures.
  // Admins get the full picture via GET /admin/reconciliation/day/:date.

  // While shift entry is disabled, shift is always FULL_DAY — surfaced as no
  // shift info at all (null label) rather than a misleading "Day Shift",
  // which keeps the frontend's shift pill hidden and the page looking
  // exactly as it did before this feature existed.
  const shiftLabel = shift === Shift.DAY ? "Day Shift" : shift === Shift.NIGHT ? "Night Shift" : null;
  const shiftFields = {
    shift,
    shiftLabel,
    shiftSource,
    shiftCutoff: `${String(Math.floor(shiftCutoffMinutes() / 60)).padStart(2, "0")}:${String(shiftCutoffMinutes() % 60).padStart(2, "0")}`,
    shiftReportTotal: shiftLabel ? shiftX.total : null,
    shiftReportCount: shiftLabel ? shiftX.count : 0,
    // Additive field for the Night-waits-on-Day feature: when true, the
    // entry pages replace their form with a waiting message instead of
    // letting staff type in Night figures. Always false for DAY/FULL_DAY.
    waitingOnDayShift: priorShiftGate.waitingOnDayShift,
    dayShiftHasEntries: priorShiftGate.dayShiftHasEntries,
    // Additive field for Issue D: the entry pages show a distinct "this
    // shift is closed" notice instead of the form when true. The admin's
    // stated closure reason is never included here — staff only see that the
    // shift is closed, never why (see storeClosure.ts / ShiftBreakdownDto).
    closed,
  };

  if (!record) {
    return res.json({
      date,
      hasTodayData: false,
      isCommitted: lockState.dayLocked,
      isPendingAdminReview: false,
      isShiftCommitted: lockState.shiftLocked,
      isLocked: lockState.locked,
      lockReason: lockState.reason,
      supplierInvoicesTotal: totals.supplierInvoicesTotal,
      instantLotteryTotalCount: totals.instantLotteryTotalCount,
      instantLotteryTotalSales: totals.instantLotteryTotalSales,
      ...shiftFields,
    });
  }

  res.json({
    date: record.date,
    hasTodayData: true,
    // Deliberately NOT record.isCommitted / record.isPendingAdminReview: those
    // DailySummary columns are never written by anything and are permanently
    // false. The real locks live on ReconciliationRecord (day) and
    // ShiftReconciliation (shift) — see lib/entryLock.ts.
    isCommitted: lockState.dayLocked,
    // Kept in the payload for backward compatibility with the entry pages,
    // which read it. Nothing sets a "pending review" state today, and the
    // day lock above already covers everything it was meant to gate.
    isPendingAdminReview: false,
    isShiftCommitted: lockState.shiftLocked,
    isLocked: lockState.locked,
    lockReason: lockState.reason,
    committedAt: reconciliation?.committedAt ?? null,
    lastSafe: record.lastSafe,
    safeDropAmount: record.safeDropAmount,
    cashback: record.cashback,
    paypointPayout: record.paypointPayout,
    instantLotteryPayout: record.instantLotteryPayout,
    lotteryPayout: record.lotteryPayout,
    newsVoucher: record.newsVoucher,
    ddPoint: record.ddPoint,
    lotteryValue: record.lotteryValue,
    paypointValue: record.paypointValue,
    staffNotes: record.staffNotes,
    supplierInvoicesTotal: totals.supplierInvoicesTotal,
    instantLotteryTotalCount: totals.instantLotteryTotalCount,
    instantLotteryTotalSales: totals.instantLotteryTotalSales,
    creditCardEntries: record.creditCardEntries.map((e) => ({
      id: e.creditCardEntryId,
      manualCardAmount: e.manualCardAmount,
      cardAmount: e.cardAmount,
      createdDate: e.createdDate,
    })),
    ...shiftFields,
  });
});

summaryRouter.put("/", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const { date, shift } = await getActiveContext();
  if (await blockIfLocked(res, date, shift)) return;
  if (await blockIfPriorShiftPending(res, date, shift)) return;

  const body = req.body ?? {};

  const fieldData = Object.fromEntries(EDITABLE_KEYS.map((k) => [k, toNumber(body[k])]));
  const lastSafe = toNumber(body.lastSafe);
  const safeDropAmount = toNumber(body.safeDropAmount);
  // staffNotes (C-revised) — a string, not one of the numeric EDITABLE_KEYS,
  // so it's handled separately here. Persisted per-day on DailySummary
  // (distinct from ReconciliationRecord.staffNotes, which is the immutable
  // snapshot written once at commit time).
  const staffNotes = typeof body.staffNotes === "string" && body.staffNotes.trim() ? body.staffNotes.trim() : null;
  const lastEditedByUserId = req.userId;
  const lastEditedByName = req.userName ?? null;

  const record = await prisma.dailySummary.upsert({
    where: { date_shift: { date, shift } },
    create: { date, shift, ...fieldData, lastSafe, safeDropAmount, staffNotes, lastEditedByUserId, lastEditedByName },
    update: { ...fieldData, lastSafe, safeDropAmount, staffNotes, lastEditedByUserId, lastEditedByName },
  });

  const incomingEntries: Array<{ id?: number; manualCardAmount: unknown; cardAmount: unknown }> =
    Array.isArray(body.creditCardEntries) ? body.creditCardEntries : [];

  const keepIds: number[] = [];
  for (const entry of incomingEntries) {
    const manualCardAmount = toNumber(entry.manualCardAmount);
    const cardAmount = toNumber(entry.cardAmount);

    if (entry.id) {
      const updated = await prisma.creditCardEntry.update({
        where: { creditCardEntryId: entry.id },
        data: { manualCardAmount, cardAmount },
      });
      keepIds.push(updated.creditCardEntryId);
    } else {
      const created = await prisma.creditCardEntry.create({
        data: { dailySummaryId: record.dailySummaryId, manualCardAmount, cardAmount },
      });
      keepIds.push(created.creditCardEntryId);
    }
  }

  await prisma.creditCardEntry.deleteMany({
    where: { dailySummaryId: record.dailySummaryId, creditCardEntryId: { notIn: keepIds } },
  });

  // Fire-and-forget, same pattern as the existing writeAuditLog calls —
  // staff correcting their figures should clear a variance without waiting
  // for the next poller cycle. No-ops on its own while SHIFT_ENTRY_ENABLED
  // is off (see evaluateAndNotify's doc comment).
  void evaluateAndNotify(date, shift);

  res.json({ message: "Summary saved successfully" });
});

async function getZReportForDate(targetDate: Date) {
  return gmailService.findZReportEmail(targetDate);
}

// Whether a Z-Report exists for a date, without shipping the email body.
// Backs the Commit page's pre-flight check so it can block the button and
// show the same wording POST /commit would reject with. Defaults to the
// active date when no `date` is supplied.
summaryRouter.get("/zreport-status", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const targetDate = req.query.date ? dateOnly(req.query.date as string) : await getActiveDate();

  let available = false;
  try {
    available = (await getZReportForDate(targetDate)) != null;
  } catch {
    available = false;
  }

  res.json({
    date: targetDate,
    available,
    message: available ? null : Z_REPORT_MISSING_MESSAGE,
  });
});

// Non-admin-gated (same reasoning as /committed-dates below): the Commit
// page's readiness panel needs to show "how are today's shifts looking"
// before committing, which is a staff concern, not an admin one. Deliberately
// role-agnostic AND Z-blind: this route calls getStaffShiftBreakdown, which
// never computes an xVsZ figure in the first place, so it is physically
// incapable of leaking Z-Report data to anyone who calls it — admin or
// staff. Admins get the full picture (including Z) via the dedicated
// GET /admin/reconciliation/day/:date route instead.
summaryRouter.get("/shift-status", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const targetDate = req.query.date ? dateOnly(req.query.date as string) : await getActiveDate();

  // The caller's own shift comes from the server, never the query string, so
  // asking for another date cannot widen what money they get to see. Other
  // shifts come back as status only.
  const { shift: activeShift } = await getActiveContext();
  const [breakdown, priorShiftGate] = await Promise.all([
    getStaffShiftBreakdown(targetDate, activeShift),
    getPriorShiftGate(targetDate, activeShift),
  ]);

  res.json({
    date: targetDate,
    activeShift,
    waitingOnDayShift: priorShiftGate.waitingOnDayShift,
    dayShiftHasEntries: priorShiftGate.dayShiftHasEntries,
    ...breakdown,
  });
});

// Staff's own shift's full till report — departments, VAT, tender, voids,
// every product, at the same depth admins get on the Till Report Check page.
// Deliberately has NO query parameters: date and shift come only from
// getActiveContext() (server-side session state), so nothing the client
// sends can widen this beyond the caller's own current shift. Never gated by
// the Day→Night prior-shift lock or by a shift closure — unlike the entry
// routes above, viewing your own shift's report is not an "action" this app
// needs to sequence; it shows the report the moment the till has emailed it.
// getStaffOwnShiftReport itself only ever queries reportType: X_REPORT for
// this exact (date, shift), so Z-Report data is structurally unreachable
// through this route, not merely omitted by convention.
summaryRouter.get("/my-shift-report", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const { date, shift } = await getActiveContext();
  const report = await getStaffOwnShiftReport(date, shift);

  res.json({ date, shift, ...report });
});

// Staff-safe DAY/NIGHT status calendar for a date range — no Z-Report
// figures anywhere in the response (see getStatusCalendar/toStaffStatusDto).
// Backs the repurposed Shift Reconciliation calendar page.
summaryRouter.get("/shift-calendar", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const fromParam = req.query.fromDate as string | undefined;
  const toParam = req.query.toDate as string | undefined;
  if (!fromParam || !toParam) {
    return res.status(400).json({ message: "fromDate and toDate query parameters are required." });
  }

  const dates = await getStatusCalendar(dateOnly(fromParam), dateOnly(toParam));
  res.json({ dates: dates.map(toStaffStatusDto) });
});

// Staff sign-off for ONE shift.
//
// Deliberately has no Z-Report gate, which is the whole point of it existing
// alongside POST /commit: the Z-Report only arrives after the night shift, so
// gating here would make it impossible for the morning shift to ever sign off.
// A shift is validated against its own X-Report instead, which lands at the end
// of that shift and is what evaluateAndNotify already compares against.
//
// The day-level POST /commit below is unchanged and remains the final,
// Z-gated step that closes the whole day.
summaryRouter.post("/shift-commit", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  // Session comes from the server. A body-supplied date or shift is ignored
  // outright, so a staff member cannot sign off a shift they are not working.
  const { date, shift } = await getActiveContext();

  if (shift === Shift.FULL_DAY) {
    return res.status(400).json({
      message: "Per-shift commit is not available while shift entry is turned off.",
    });
  }

  // Night cannot be committed while it is still waiting on Day — Day must be
  // staff-submitted first (see isPriorShiftPending in lib/entryLock.ts). An
  // admin can unblock this via POST /admin/reconciliation/shift/
  // force-unlock-night if Day staff are unavailable.
  if (shift === Shift.NIGHT && (await isPriorShiftPending(date, shift))) {
    return res.status(409).json({
      message: "The Day shift must be submitted before the Night shift can be committed.",
      waitingOnDayShift: true,
    });
  }

  const lockState = await getLockState(date, shift);
  if (lockState.locked) {
    return res.status(409).json({
      message: lockState.shiftLocked
        ? "This shift has already been committed."
        : lockState.reason,
      dayLocked: lockState.dayLocked,
      shiftLocked: lockState.shiftLocked,
    });
  }

  const totals = await computeShiftTotals(date, shift);

  // Boundary validation only. Tolerance and variance are owned by
  // lib/variance.ts and the evaluate* pipeline — this just refuses figures that
  // could not be right under any tolerance, naming the field so the user can
  // find it rather than showing a generic failure.
  const invalid = Object.entries(totals).find(
    ([, value]) => typeof value === "number" && (!Number.isFinite(value) || value < 0)
  );
  if (invalid) {
    return res.status(400).json({
      message: `${invalid[0]} is ${invalid[1]}, which cannot be committed. Please review the highlighted fields.`,
      field: invalid[0],
      value: invalid[1],
    });
  }

  const body = req.body ?? {};
  const shiftStaffNotes =
    typeof body.staffNotes === "string" && body.staffNotes.trim() ? body.staffNotes.trim() : null;

  const committedAt = new Date();

  // Only the commit columns are written here. Everything else on the row is
  // owned by evaluateShift, which recomputes it from the till and the entry
  // pages — writing totals here would fight that pipeline.
  const row = await prisma.shiftReconciliation.upsert({
    where: { date_shift: { date, shift } },
    create: {
      date,
      shift,
      isShiftCommitted: true,
      shiftCommittedByUserId: req.userId,
      shiftCommittedByName: req.userName ?? null,
      shiftCommittedAt: committedAt,
      shiftStaffNotes,
    },
    update: {
      isShiftCommitted: true,
      shiftCommittedByUserId: req.userId,
      shiftCommittedByName: req.userName ?? null,
      shiftCommittedAt: committedAt,
      shiftStaffNotes,
    },
  });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "shift_commit",
    entity: "ShiftReconciliation",
    entityId: row.shiftReconciliationId,
    newValue: {
      date: date.toISOString().split("T")[0],
      shift,
      staffEnteredTotal: totals.summaryTotal,
      committedAt: committedAt.toISOString(),
    },
  });

  // Re-run the variance check now the shift is final. If it is out of
  // tolerance this raises the existing shift-variance email to the admin;
  // if it is fine, nothing is sent. Fire-and-forget, exactly as every entry
  // route already calls it.
  void evaluateAndNotify(date, shift);

  res.json({
    message: "Shift committed",
    date: date.toISOString().split("T")[0],
    shift,
    committedAt,
    committedByName: req.userName ?? null,
    staffEnteredTotal: totals.summaryTotal,
  });
});

summaryRouter.post("/commit", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const body = req.body ?? {};
  const staffNotes = typeof body.staffNotes === "string" && body.staffNotes.trim() ? body.staffNotes.trim() : null;

  const date = await getActiveDate();

  // Commit gate: a day can only be committed once its Z-Report has actually
  // arrived. Enforced here as well as on the Commit page, since the page's
  // check is only as good as the client running it. A lookup that errors
  // outright counts as "not available" — better to block a commit we cannot
  // verify than to record one against a Z-Report total of zero.
  let email = null;
  try {
    email = await gmailService.findZReportEmail(date);
  } catch {
    email = null;
  }
  if (!email) {
    return res.status(400).json({ message: Z_REPORT_MISSING_MESSAGE, zReportAvailable: false });
  }

  // The email is present but its Department Total line may still be
  // unparseable (format changes, truncated body). That is not the same as a
  // missing report, so it falls back to 0 and leaves the variance visible to
  // the admin rather than blocking the commit.
  const zReportTotal = parseDepartmentTotal(email.body) ?? 0;

  const totals = await computeDailyTotals(date);
  const difference = Math.abs(totals.summaryTotal - zReportTotal);
  const committedAt = new Date();

  const record = await prisma.reconciliationRecord.upsert({
    where: { date },
    create: {
      date,
      ...totals,
      zReportTotal,
      difference,
      staffNotes,
      isStaffCommitted: true,
      committedByUserId: req.userId,
      committedByName: req.userName ?? null,
      committedAt,
    },
    update: {
      ...totals,
      zReportTotal,
      difference,
      staffNotes,
      isStaffCommitted: true,
      committedByUserId: req.userId,
      committedByName: req.userName ?? null,
      committedAt,
    },
  });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "staff_commit",
    entity: "ReconciliationRecord",
    entityId: date.toISOString().split("T")[0],
    newValue: { ...totals, zReportTotal, difference, staffNotes },
  });

  await sendCommitNotificationEmail({
    dateStr: date.toISOString().split("T")[0],
    summaryTotal: totals.summaryTotal,
    zReportTotal,
    difference,
    staffNotes,
  });

  // Refresh the X-vs-Z snapshot on the record we just committed. No-ops
  // (writes nulls) while SHIFT_ENTRY_ENABLED is off or no shifts have final
  // totals yet — never fails the commit itself.
  void evaluateDay(date);

  res.json({ message: "Committed successfully", committedAt: record.committedAt });
});

// Lightweight, non-admin-gated list of committed dates within a range — used
// by the Shop Sale calendar (any authenticated staff member) to grey out
// dates that already have a completed reconciliation, without exposing any
// of the admin-only reconciliation detail that /admin/reconciliation/committed
// returns. Deliberately returns nothing but the date strings.
summaryRouter.get("/committed-dates", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const fromDate = req.query.fromDate ? dateOnly(req.query.fromDate as string) : undefined;
  const toDate = req.query.toDate ? dateOnly(req.query.toDate as string) : undefined;

  const records = await prisma.reconciliationRecord.findMany({
    where: {
      OR: [{ isStaffCommitted: true }, { isAdminReconciled: true }],
      date: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      },
    },
    select: { date: true },
    orderBy: { date: "asc" },
  });

  res.json({ dates: records.map((r) => r.date.toISOString().split("T")[0]) });
});
