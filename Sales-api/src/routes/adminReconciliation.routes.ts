import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { dateOnly } from "../lib/activeDate.js";
import { computeDailyTotals } from "../lib/dailyTotals.js";
import { renderZReportBillPdf } from "../lib/pdf.js";
import { buildZip } from "../lib/zip.js";
import * as gmailService from "../services/gmail.service.js";

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

  const [allDays, reconciled] = await Promise.all([
    prisma.dailySummary.findMany({ orderBy: { date: "desc" } }),
    prisma.reconciliationRecord.findMany({ select: { date: true } }),
  ]);
  const reconciledDates = new Set(reconciled.map((r) => r.date.toISOString()));
  const uncommitted = allDays.filter((day) => !reconciledDates.has(day.date.toISOString()));

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

adminReconciliationRouter.get("/download-bill", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const dateParam = req.query.date as string | undefined;
  if (!dateParam) return res.status(400).json({ message: "date query parameter is required." });

  const date = dateOnly(dateParam);
  const email = await gmailService.findZReportEmail(date);
  if (!email) return res.status(400).json({ message: "No Z-report email found for this date." });

  const pdf = await renderZReportBillPdf(date, email.body);
  const dateStr = date.toISOString().split("T")[0];
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="zreport-bill-${dateStr}.pdf"`);
  res.send(pdf);
});

adminReconciliationRouter.get("/download-bills-range", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const fromParam = req.query.fromDate as string | undefined;
  const toParam = req.query.toDate as string | undefined;
  if (!fromParam || !toParam) return res.status(400).json({ message: "fromDate and toDate query parameters are required." });

  const fromDate = dateOnly(fromParam);
  const toDate = dateOnly(toParam);

  const files: Array<{ name: string; content: Buffer }> = [];
  for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const current = new Date(d);
    const email = await gmailService.findZReportEmail(current);
    if (!email) continue;

    const pdf = await renderZReportBillPdf(current, email.body);
    files.push({ name: `zreport-bill-${current.toISOString().split("T")[0]}.pdf`, content: pdf });
  }

  if (files.length === 0) return res.status(400).json({ message: "No Z-report emails found for this range." });

  const zip = await buildZip(files);
  const fromStr = fromDate.toISOString().split("T")[0];
  const toStr = toDate.toISOString().split("T")[0];
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="zreport-bills-${fromStr}-to-${toStr}.zip"`);
  res.send(zip);
});
