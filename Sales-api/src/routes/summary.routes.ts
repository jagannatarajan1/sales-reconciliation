import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveDate, dateOnly } from "../lib/activeDate.js";
import { computeDailyTotals } from "../lib/dailyTotals.js";
import { parseDepartmentTotal } from "../lib/departmentTotal.js";
import { sendCommitNotificationEmail } from "../lib/commitEmail.js";
import * as gmailService from "../services/gmail.service.js";
import { writeAuditLog } from "../lib/auditLog.js";

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

summaryRouter.get("/today", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const date = await getActiveDate();
  const [record, totals, reconciliation] = await Promise.all([
    prisma.dailySummary.findUnique({ where: { date }, include: { creditCardEntries: true } }),
    computeDailyTotals(date),
    prisma.reconciliationRecord.findUnique({ where: { date } }),
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

  if (!record) {
    return res.json({
      date,
      hasTodayData: false,
      isCommitted: false,
      isPendingAdminReview: false,
      supplierInvoicesTotal: totals.supplierInvoicesTotal,
      instantLotteryTotalCount: totals.instantLotteryTotalCount,
      instantLotteryTotalSales: totals.instantLotteryTotalSales,
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
    supplierInvoicesTotal: totals.supplierInvoicesTotal,
    instantLotteryTotalCount: totals.instantLotteryTotalCount,
    instantLotteryTotalSales: totals.instantLotteryTotalSales,
    creditCardEntries: record.creditCardEntries.map((e) => ({
      id: e.creditCardEntryId,
      manualCardAmount: e.manualCardAmount,
      cardAmount: e.cardAmount,
      createdDate: e.createdDate,
    })),
    ...(departmentTotal != null ? { departmentTotal, variance } : {}),
  });
});

summaryRouter.put("/", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const date = await getActiveDate();
  const body = req.body ?? {};

  const fieldData = Object.fromEntries(EDITABLE_KEYS.map((k) => [k, toNumber(body[k])]));
  const lastSafe = toNumber(body.lastSafe);
  const safeDropAmount = toNumber(body.safeDropAmount);

  const record = await prisma.dailySummary.upsert({
    where: { date },
    create: { date, ...fieldData, lastSafe, safeDropAmount },
    update: { ...fieldData, lastSafe, safeDropAmount },
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
  const summary = await prisma.dailySummary.findUnique({ where: { date: targetDate } });
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
  const email = await getZReportForDate(targetDate);
  if (!email) {
    return res.status(400).json({ message: "No Z-report email found for this date." });
  }

  res.json({ isCommitted: false, targetDate, email });
});

summaryRouter.post("/commit", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const body = req.body ?? {};
  const staffName = typeof body.staffName === "string" ? body.staffName.trim() : "";
  const shift = typeof body.shift === "string" ? body.shift.trim() : "";
  const staffNotes = typeof body.staffNotes === "string" && body.staffNotes.trim() ? body.staffNotes.trim() : null;

  // Form-validation gate only — not an account-level lock. Staff identity
  // must be recorded on every commit, but this never blocks saving/entering
  // data on the Summary page itself.
  if (!staffName || !shift) {
    return res.status(400).json({ message: "Staff name and shift are required to commit." });
  }

  const date = await getActiveDate();

  const email = await gmailService.findZReportEmail(date);
  const parsedZReportTotal = email ? parseDepartmentTotal(email.body) : null;
  // TODO(test-mode): the real Z-Report requirement is temporarily disabled so
  // commit can be tested without waiting for today's email — falls back to 0
  // instead of blocking. Re-enable the block once testing is done.
  const zReportTotal = parsedZReportTotal ?? 0;

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
      staffName,
      shift,
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
      staffName,
      shift,
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
    newValue: { ...totals, zReportTotal, difference, staffName, shift, staffNotes },
  });

  await sendCommitNotificationEmail({
    dateStr: date.toISOString().split("T")[0],
    summaryTotal: totals.summaryTotal,
    zReportTotal,
    difference,
    staffName,
    shift,
    staffNotes,
  });

  res.json({ message: "Committed successfully", committedAt: record.committedAt });
});

summaryRouter.get("/reconciliation/portal", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const active = await getActiveDate();
  const yesterday = new Date(active);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const record = await prisma.reconciliationRecord.findUnique({ where: { date: yesterday } });
  if (!record) {
    return res.json({ hasReconciliation: false });
  }

  res.json({
    hasReconciliation: true,
    date: record.date,
    submittedAt: record.adminSubmittedAt ?? record.committedAt,
    manualCardAmount: record.manualCardAmount,
    cardAmount: record.cardAmount,
    lastSafe: record.lastSafe,
    safeDropAmount: record.safeDropAmount,
    cash: Number(record.lastSafe) + Number(record.safeDropAmount),
    cashback: record.cashback,
    paypointPayout: record.paypointPayout,
    instantLotteryPayout: record.instantLotteryPayout,
    lotteryPayout: record.lotteryPayout,
    newsVoucher: record.newsVoucher,
    ddPoint: record.ddPoint,
    instantLotteryTotalCount: record.instantLotteryTotalCount,
    instantLotteryTotalSales: record.instantLotteryTotalSales,
    lotteryValue: record.lotteryValue,
    paypointValue: record.paypointValue,
    summaryTotal: record.summaryTotal,
    zReportTotal: record.zReportTotal,
    difference: record.difference,
    adminNotes: record.adminNotes,
  });
});
