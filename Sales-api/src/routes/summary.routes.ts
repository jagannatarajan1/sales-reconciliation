import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveDate, getActiveContext, dateOnly, shiftCutoffMinutes } from "../lib/activeDate.js";
import { computeDailyTotals } from "../lib/dailyTotals.js";
import { parseDepartmentTotal } from "../lib/departmentTotal.js";
import { sendCommitNotificationEmail } from "../lib/commitEmail.js";
import * as gmailService from "../services/gmail.service.js";
import { getShiftXTotal } from "../lib/tillReportIngest.js";
import { evaluateAndNotify, evaluateDay, getShiftBreakdown } from "../lib/shiftReconciliation.js";
import { writeAuditLog } from "../lib/auditLog.js";
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

// A date is off-limits to the user-facing Shop Sale / Commit flow once it has
// been committed by a user or signed off by an admin — the same predicate the
// committed-dates calendar feed uses, so the two can never disagree.
async function isDateCommitted(date: Date): Promise<boolean> {
  const record = await prisma.reconciliationRecord.findUnique({ where: { date } });
  return !!record && (record.isStaffCommitted || record.isAdminReconciled);
}

summaryRouter.get("/today", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const { date, shift, shiftSource } = await getActiveContext();
  const [record, totals, reconciliation, shiftX] = await Promise.all([
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
  ]);

  // Best-effort live comparison against today's Z-Report, if it has arrived
  // yet. This must never fail/error the whole endpoint — Summary has to keep
  // loading even before the day's report shows up in the inbox.
  let departmentTotal: number | null = null;
  try {
    const email = await gmailService.findZReportEmail(date);
    if (email) departmentTotal = parseDepartmentTotal(email.body);
  } catch {
    departmentTotal = null;
  }
  const variance = departmentTotal != null ? Math.round((totals.summaryTotal - departmentTotal) * 100) / 100 : null;

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
  };

  if (!record) {
    return res.json({
      date,
      hasTodayData: false,
      isCommitted: false,
      isPendingAdminReview: false,
      supplierInvoicesTotal: totals.supplierInvoicesTotal,
      instantLotteryTotalCount: totals.instantLotteryTotalCount,
      instantLotteryTotalSales: totals.instantLotteryTotalSales,
      ...shiftFields,
      ...(departmentTotal != null ? { departmentTotal, variance } : {}),
    });
  }

  res.json({
    date: record.date,
    hasTodayData: true,
    isCommitted: record.isCommitted,
    isPendingAdminReview: record.isPendingAdminReview,
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
    ...(departmentTotal != null ? { departmentTotal, variance } : {}),
  });
});

summaryRouter.put("/", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const { date, shift } = await getActiveContext();
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

summaryRouter.get("/zreport-email", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const targetDate = await getActiveDate();
  // isCommitted/isPendingAdminReview are set nowhere in the codebase (dead
  // fields, always false) — findFirst rather than findUnique only because
  // `date` alone is no longer a unique key; behaviour here is unchanged.
  const summary = await prisma.dailySummary.findFirst({ where: { date: targetDate } });
  if (summary?.isCommitted) {
    return res.json({ isCommitted: true, targetDate, message: "Today's values are already committed. Next Z-report available tomorrow." });
  }

  const email = await getZReportForDate(targetDate);
  if (!email) {
    return res.status(400).json({ message: "No Z-report email found for this date." });
  }

  res.json({ isCommitted: false, targetDate, email });
});

summaryRouter.get("/zreport-email/by-date", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const targetDate = dateOnly(req.query.date as string);

  // Only uncommitted dates are selectable in Shop Sale. The calendar already
  // withholds committed days, but that is presentation only — refuse them
  // here too so the rule holds for anyone calling the endpoint directly.
  if (await isDateCommitted(targetDate)) {
    return res.status(403).json({
      message: "This date has already been committed and can no longer be selected.",
    });
  }

  const email = await getZReportForDate(targetDate);
  if (!email) {
    return res.status(400).json({ message: "No Z-report email found for this date." });
  }

  res.json({ isCommitted: false, targetDate, email });
});

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
// before committing, which is a staff concern, not an admin one. Shares its
// read model with the admin pending queue via getShiftBreakdown, so the two
// surfaces can never disagree about a shift's status.
summaryRouter.get("/shift-status", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const targetDate = req.query.date ? dateOnly(req.query.date as string) : await getActiveDate();
  const breakdown = await getShiftBreakdown(targetDate);

  res.json({ date: targetDate, ...breakdown });
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
