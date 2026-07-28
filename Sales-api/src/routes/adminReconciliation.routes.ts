import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { dateOnly } from "../lib/activeDate.js";
import { computeDailyTotals } from "../lib/dailyTotals.js";

export const adminReconciliationRouter = Router();

function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  if (req.userId == null) {
    res.status(401).json({ message: "User not authenticated" });
    return false;
  }
  if (req.userRole !== "admin") {
    res.status(403).json({ message: "Admin access required." });
    return false;
  }
  return true;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

adminReconciliationRouter.get("/pending", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const uncommitted = await prisma.dailySummary.findMany({
    where: { isCommitted: false },
    orderBy: { date: "desc" },
  });

  const items = [];
  for (const day of uncommitted) {
    const totals = await computeDailyTotals(day.date);
    items.push({
      date: day.date.toISOString().split("T")[0],
      ...totals,
      zReportTotal: 0,
      difference: 0,
    });
  }

  res.json({ hasPending: items.length > 0, items });
});

adminReconciliationRouter.post("/submit", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const body = req.body ?? {};
  if (!body.date) return res.status(400).json({ message: "date is required." });

  const date = dateOnly(body.date);
  const liveTotals = await computeDailyTotals(date);

  const manualCardAmount = toNumber(body.manualCardAmount);
  const cardAmount = toNumber(body.cardAmount);
  const lastSafe = toNumber(body.lastSafe);
  const safeDropAmount = toNumber(body.safeDropAmount);
  const cashback = toNumber(body.cashback);
  const paypointPayout = toNumber(body.paypointPayout);
  const instantLotteryPayout = toNumber(body.instantLotteryPayout);
  const lotteryPayout = toNumber(body.lotteryPayout);
  const newsVoucher = toNumber(body.newsVoucher);
  const ddPoint = toNumber(body.ddPoint);
  const supplierInvoicesTotal = toNumber(body.supplierInvoicesTotal);
  const lotteryValue = toNumber(body.lotteryValue);
  const paypointValue = toNumber(body.paypointValue);
  const zReportTotal = toNumber(body.zReportTotal);
  const adminNotes = body.adminNotes ? String(body.adminNotes) : null;

  const instantLotteryTotalCount = liveTotals.instantLotteryTotalCount;
  const instantLotteryTotalSales = liveTotals.instantLotteryTotalSales;

  const summaryTotal =
    manualCardAmount +
    cardAmount +
    lastSafe +
    safeDropAmount +
    cashback +
    paypointPayout +
    instantLotteryPayout +
    lotteryPayout +
    newsVoucher +
    ddPoint +
    supplierInvoicesTotal +
    instantLotteryTotalSales +
    lotteryValue +
    paypointValue;
  const difference = Math.abs(summaryTotal - zReportTotal);

  const existing = await prisma.reconciliationRecord.findUnique({ where: { date } });

  const data = {
    manualCardAmount,
    cardAmount,
    lastSafe,
    safeDropAmount,
    cashback,
    paypointPayout,
    instantLotteryPayout,
    lotteryPayout,
    newsVoucher,
    ddPoint,
    supplierInvoicesTotal,
    instantLotteryTotalCount,
    instantLotteryTotalSales,
    lotteryValue,
    paypointValue,
    summaryTotal,
    zReportTotal,
    difference,
    adminNotes,
    isAdminReconciled: true,
    adminSubmittedByUserId: req.userId,
    adminSubmittedByName: req.userName ?? null,
    adminSubmittedAt: new Date(),
  };

  await prisma.reconciliationRecord.upsert({
    where: { date },
    create: { date, ...data, isStaffCommitted: existing?.isStaffCommitted ?? false },
    update: data,
  });

  await prisma.dailySummary.upsert({
    where: { date },
    create: { date, isCommitted: true },
    update: { isCommitted: true },
  });

  res.json({ message: "Reconciliation submitted successfully" });
});

adminReconciliationRouter.get("/committed", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const fromDate = req.query.fromDate ? dateOnly(req.query.fromDate as string) : undefined;
  const toDate = req.query.toDate ? dateOnly(req.query.toDate as string) : undefined;

  const records = await prisma.reconciliationRecord.findMany({
    where: {
      date: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      },
    },
    orderBy: { date: "desc" },
  });

  res.json(
    records.map((r) => ({
      date: r.date.toISOString().split("T")[0],
      summaryTotal: r.summaryTotal,
      isStaffCommitted: r.isStaffCommitted,
      isAdminReconciled: r.isAdminReconciled,
    })),
  );
});

adminReconciliationRouter.get("/committed/:date", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const date = dateOnly(req.params.date);
  const record = await prisma.reconciliationRecord.findUnique({ where: { date } });
  if (!record) return res.status(404).json({ message: "No committed record found for this date." });

  res.json({
    date: record.date.toISOString().split("T")[0],
    manualCardAmount: record.manualCardAmount,
    cardAmount: record.cardAmount,
    lastSafe: record.lastSafe,
    safeDropAmount: record.safeDropAmount,
    cashback: record.cashback,
    paypointPayout: record.paypointPayout,
    instantLotteryPayout: record.instantLotteryPayout,
    lotteryPayout: record.lotteryPayout,
    newsVoucher: record.newsVoucher,
    ddPoint: record.ddPoint,
    supplierInvoicesTotal: record.supplierInvoicesTotal,
    instantLotteryTotalCount: record.instantLotteryTotalCount,
    instantLotteryTotalSales: record.instantLotteryTotalSales,
    lotteryValue: record.lotteryValue,
    paypointValue: record.paypointValue,
    summaryTotal: record.summaryTotal,
    zReportTotal: record.zReportTotal,
    difference: record.difference,
    adminNotes: record.adminNotes,
    isStaffCommitted: record.isStaffCommitted,
    isAdminReconciled: record.isAdminReconciled,
    committedByName: record.committedByName,
    committedAt: record.committedAt,
  });
});
