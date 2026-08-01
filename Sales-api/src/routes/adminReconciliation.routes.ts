import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { dateOnly } from "../lib/activeDate.js";
import { computeDailyTotals } from "../lib/dailyTotals.js";
import { parseDepartmentTotal } from "../lib/departmentTotal.js";
import { renderReconciliationReportPdf } from "../lib/pdf.js";
import { sendCommitNotificationEmail } from "../lib/commitEmail.js";
import { buildZReportBillsZip } from "../lib/zReportBills.js";
import * as gmailService from "../services/gmail.service.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/auditLog.js";

export const adminReconciliationRouter = Router();

function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  return requirePermission(req, res, "commitHistory");
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const VARIANCE_TOLERANCE = 5;

adminReconciliationRouter.get("/pending", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const [allDays, records] = await Promise.all([
    prisma.dailySummary.findMany({ orderBy: { date: "desc" } }),
    prisma.reconciliationRecord.findMany(),
  ]);
  const recordsByDate = new Map(records.map((r) => [r.date.toISOString(), r]));

  const items = [];
  for (const day of allDays) {
    const record = recordsByDate.get(day.date.toISOString());

    // No committed record at all -> always pending.
    if (!record) {
      const totals = await computeDailyTotals(day.date);
      let zReportTotal = 0;
      try {
        const email = await gmailService.findZReportEmail(day.date);
        const parsed = email ? parseDepartmentTotal(email.body) : null;
        if (parsed != null) zReportTotal = parsed;
      } catch {
        // Best-effort pre-fill only — fall back to 0 so the admin can still
        // type the value in by hand, exactly as before.
      }
      const difference = Math.abs(totals.summaryTotal - zReportTotal);

      items.push({
        date: day.date.toISOString().split("T")[0],
        ...totals,
        zReportTotal,
        difference,
        staffNotes: day.staffNotes ?? null,
      });
      continue;
    }

    // A record exists — it only keeps showing up here if it hasn't been
    // signed off by admin yet AND its variance is over tolerance. Anything
    // within tolerance, or already admin-reconciled, drops off the list.
    if (record.isAdminReconciled) continue;
    if (Math.abs(Number(record.difference)) <= VARIANCE_TOLERANCE) continue;

    items.push({
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
      staffNotes: record.staffNotes ?? null,
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

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "admin_reconciliation_submit",
    entity: "ReconciliationRecord",
    entityId: date.toISOString().split("T")[0],
    previousValue: existing ?? null,
    newValue: data,
  });

  await sendCommitNotificationEmail({
    dateStr: date.toISOString().split("T")[0],
    summaryTotal,
    zReportTotal,
    difference,
    adminNotes,
  });

  res.json({ message: "Reconciliation submitted successfully" });
});

// "Committed" here means what it says — a record only qualifies once staff
// have actually committed it and/or admin has signed off (mirrors the same
// predicate reports.routes.ts uses for the Sales Reconciliation page). This
// also backs the "Recent Commits" quick-select chips on the frontend, which
// would otherwise be able to surface a date that was never really committed.
const COMMITTED_ONLY_WHERE = {
  OR: [{ isStaffCommitted: true }, { isAdminReconciled: true }],
};

adminReconciliationRouter.get("/committed", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const fromDate = req.query.fromDate ? dateOnly(req.query.fromDate as string) : undefined;
  const toDate = req.query.toDate ? dateOnly(req.query.toDate as string) : undefined;

  const records = await prisma.reconciliationRecord.findMany({
    where: {
      ...COMMITTED_ONLY_WHERE,
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
  if (!record || !(record.isStaffCommitted || record.isAdminReconciled)) {
    return res.status(404).json({ message: "No committed record found for this date." });
  }

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
    staffNotes: record.staffNotes,
    isStaffCommitted: record.isStaffCommitted,
    isAdminReconciled: record.isAdminReconciled,
    committedByName: record.committedByName,
    committedAt: record.committedAt,
  });
});

// "Download Bill" — thin wrapper around the same single-date Sales
// Reconciliation renderer used by GET /api/reports/download-pdf (Stage 3),
// so the button shows the full, properly formatted reconciliation report for
// that date rather than the raw Z-report-email PDF. Kept as its own endpoint
// (rather than pointing the frontend at /api/reports/download-pdf directly)
// so it stays gated on "commitHistory" — the same permission this button
// has always required — instead of picking up the "reports" module's gate.
adminReconciliationRouter.get("/download-bill", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const dateParam = req.query.date as string | undefined;
  if (!dateParam) return res.status(400).json({ message: "date query parameter is required." });

  const date = dateOnly(dateParam);
  const record = await prisma.reconciliationRecord.findUnique({ where: { date } });
  if (!record || !(record.isStaffCommitted || record.isAdminReconciled)) {
    return res.status(404).json({ message: "No committed reconciliation found for this date." });
  }

  const pdf = await renderReconciliationReportPdf(record, { generatedByName: req.userName });
  const dateStr = date.toISOString().split("T")[0];
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="reconciliation-report-${dateStr}.pdf"`);
  res.send(pdf);
});

adminReconciliationRouter.get("/download-bills-range", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const fromParam = req.query.fromDate as string | undefined;
  const toParam = req.query.toDate as string | undefined;
  if (!fromParam || !toParam) return res.status(400).json({ message: "fromDate and toDate query parameters are required." });

  const fromDate = dateOnly(fromParam);
  const toDate = dateOnly(toParam);

  const zip = await buildZReportBillsZip(fromDate, toDate, { generatedByName: req.userName });
  if (!zip) return res.status(400).json({ message: "No Z-report emails found for this range." });

  const fromStr = fromDate.toISOString().split("T")[0];
  const toStr = toDate.toISOString().split("T")[0];
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="zreport-bills-${fromStr}-to-${toStr}.zip"`);
  res.send(zip);
});
