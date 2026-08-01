import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { dateOnly } from "../lib/activeDate.js";
import { parseDepartmentTotal } from "../lib/departmentTotal.js";
import { renderReconciliationReportPdf, renderReconciliationRangeReportPdf } from "../lib/pdf.js";
import { buildReconciliationExcel } from "../lib/excel.js";
import { buildZip } from "../lib/zip.js";
import * as gmailService from "../services/gmail.service.js";
import { requirePermission } from "../lib/permissions.js";

export const reportsRouter = Router();

function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  return requirePermission(req, res, "reports");
}

// Sales Reconciliation is finalized-days-only: a record only belongs here
// once staff have committed it and/or admin has signed off on it. A row that
// exists purely because admin opened the "Uncommitted Data" tab (which
// creates no ReconciliationRecord at all) never reaches this table, but this
// predicate also guards against any record that technically exists yet was
// never actually committed by either party.
const COMMITTED_ONLY_WHERE = {
  OR: [{ isStaffCommitted: true }, { isAdminReconciled: true }],
};

reportsRouter.get("/", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const startDate = req.query.startDate ? dateOnly(req.query.startDate as string) : undefined;
  const endDate = req.query.endDate ? dateOnly(req.query.endDate as string) : undefined;

  const records = await prisma.reconciliationRecord.findMany({
    where: {
      ...COMMITTED_ONLY_WHERE,
      date: {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
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

reportsRouter.get("/download-pdf", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const startDate = req.query.startDate ? dateOnly(req.query.startDate as string) : undefined;
  const endDate = req.query.endDate ? dateOnly(req.query.endDate as string) : undefined;
  if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate are required." });

  const records = await prisma.reconciliationRecord.findMany({
    where: { ...COMMITTED_ONLY_WHERE, date: { gte: startDate, lte: endDate } },
    orderBy: { date: "asc" },
  });
  if (records.length === 0) return res.status(404).json({ message: "No reports found for this range." });

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];
  const meta = { generatedByName: req.userName };

  if (records.length === 1) {
    const pdf = await renderReconciliationReportPdf(records[0], meta);
    const dateStr = records[0].date.toISOString().split("T")[0];
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="reconciliation-report-${dateStr}.pdf"`);
    return res.send(pdf);
  }

  const files = await Promise.all(
    records.map(async (r) => ({
      name: `reconciliation-report-${r.date.toISOString().split("T")[0]}.pdf`,
      content: await renderReconciliationReportPdf(r, meta),
    })),
  );
  const zip = await buildZip(files);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="reconciliation-reports-${startStr}-to-${endStr}.zip"`);
  res.send(zip);
});

// Single combined multi-date PDF (one table, one file) rather than the
// per-date ZIP that /download-pdf produces — used by the Excel-adjacent
// "combined" export button on the Sales Reconciliation page.
reportsRouter.get("/download-pdf-combined", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const startDate = req.query.startDate ? dateOnly(req.query.startDate as string) : undefined;
  const endDate = req.query.endDate ? dateOnly(req.query.endDate as string) : undefined;
  if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate are required." });

  const records = await prisma.reconciliationRecord.findMany({
    where: { ...COMMITTED_ONLY_WHERE, date: { gte: startDate, lte: endDate } },
    orderBy: { date: "asc" },
  });
  if (records.length === 0) return res.status(404).json({ message: "No reports found for this range." });

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];
  const pdf = await renderReconciliationRangeReportPdf(records, startStr, endStr, { generatedByName: req.userName });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="sales-reconciliation-${startStr}-to-${endStr}.pdf"`);
  res.send(pdf);
});

reportsRouter.get("/download-excel", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const startDate = req.query.startDate ? dateOnly(req.query.startDate as string) : undefined;
  const endDate = req.query.endDate ? dateOnly(req.query.endDate as string) : undefined;
  if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate are required." });

  const records = await prisma.reconciliationRecord.findMany({
    where: { ...COMMITTED_ONLY_WHERE, date: { gte: startDate, lte: endDate } },
    orderBy: { date: "asc" },
  });
  if (records.length === 0) return res.status(404).json({ message: "No reports found for this range." });

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];
  const excel = await buildReconciliationExcel(records, startStr, endStr, { generatedByName: req.userName });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="sales-reconciliation-${startStr}-to-${endStr}.xlsx"`);
  res.send(excel);
});

reportsRouter.get("/:date", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const date = dateOnly(req.params.date);
  const record = await prisma.reconciliationRecord.findUnique({ where: { date } });
  if (!record || !(record.isStaffCommitted || record.isAdminReconciled)) {
    return res.status(404).json({ message: "No report found for this date." });
  }

  // Re-check the real email for this historical date rather than blindly
  // trusting whatever was stored at commit time (which could have been a
  // manual guess before this parsing was built).
  let zReportAvailable = false;
  let zReportTotal: number | Prisma.Decimal = record.zReportTotal;
  let totalVariance: number | Prisma.Decimal = record.difference;
  try {
    const email = await gmailService.findZReportEmail(date);
    const parsed = email ? parseDepartmentTotal(email.body) : null;
    if (parsed != null) {
      zReportAvailable = true;
      zReportTotal = parsed;
      totalVariance = Math.round(Math.abs(Number(record.summaryTotal) - parsed) * 100) / 100;
    }
  } catch {
    // Fall back to the stored record's values below.
  }

  const fields = [
    { section: "Credit Card", field: "Manual Card Amount", staffValue: record.manualCardAmount },
    { section: "Credit Card", field: "Card Amount", staffValue: record.cardAmount },
    { section: "Cash", field: "Last Safe", staffValue: record.lastSafe },
    { section: "Cash", field: "Safe Drop Amount", staffValue: record.safeDropAmount },
    { section: "Deductions", field: "Cashback", staffValue: record.cashback },
    { section: "Deductions", field: "Paypoint Payout", staffValue: record.paypointPayout },
    { section: "Deductions", field: "Instant Lottery Payout", staffValue: record.instantLotteryPayout },
    { section: "Deductions", field: "Lottery Payout", staffValue: record.lotteryPayout },
    { section: "Deductions", field: "News Voucher", staffValue: record.newsVoucher },
    { section: "Deductions", field: "DD Point", staffValue: record.ddPoint },
    { section: "Instant Lottery", field: "Total Count", staffValue: record.instantLotteryTotalCount },
    { section: "Instant Lottery", field: "Total Sales", staffValue: record.instantLotteryTotalSales },
    { section: "Lottery", field: "Lottery Value", staffValue: record.lotteryValue },
    { section: "Paypoint", field: "Paypoint Value", staffValue: record.paypointValue },
  ].map((f) => ({ ...f, zReportValue: null }));

  res.json({
    date: record.date.toISOString().split("T")[0],
    zReportAvailable,
    isStaffCommitted: record.isStaffCommitted,
    isAdminReconciled: record.isAdminReconciled,
    committedByName: record.committedByName,
    committedAt: record.committedAt,
    adminSubmittedByName: record.adminSubmittedByName,
    adminSubmittedAt: record.adminSubmittedAt,
    fields,
    staffTotal: record.summaryTotal,
    zReportTotal,
    totalVariance,
    adminNotes: record.adminNotes,
    staffNotes: record.staffNotes,
  });
});
