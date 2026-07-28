import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { dateOnly } from "../lib/activeDate.js";
import { renderReconciliationReportPdf } from "../lib/pdf.js";
import { buildZip } from "../lib/zip.js";

export const reportsRouter = Router();

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

reportsRouter.get("/", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const startDate = req.query.startDate ? dateOnly(req.query.startDate as string) : undefined;
  const endDate = req.query.endDate ? dateOnly(req.query.endDate as string) : undefined;

  const records = await prisma.reconciliationRecord.findMany({
    where: {
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
    where: { date: { gte: startDate, lte: endDate } },
    orderBy: { date: "asc" },
  });
  if (records.length === 0) return res.status(404).json({ message: "No reports found for this range." });

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  if (records.length === 1) {
    const pdf = await renderReconciliationReportPdf(records[0]);
    const dateStr = records[0].date.toISOString().split("T")[0];
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="reconciliation-report-${dateStr}.pdf"`);
    return res.send(pdf);
  }

  const files = await Promise.all(
    records.map(async (r) => ({
      name: `reconciliation-report-${r.date.toISOString().split("T")[0]}.pdf`,
      content: await renderReconciliationReportPdf(r),
    })),
  );
  const zip = await buildZip(files);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="reconciliation-reports-${startStr}-to-${endStr}.zip"`);
  res.send(zip);
});

reportsRouter.get("/:date", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const date = dateOnly(req.params.date);
  const record = await prisma.reconciliationRecord.findUnique({ where: { date } });
  if (!record) return res.status(404).json({ message: "No report found for this date." });

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
    zReportAvailable: false,
    isStaffCommitted: record.isStaffCommitted,
    isAdminReconciled: record.isAdminReconciled,
    committedByName: record.committedByName,
    committedAt: record.committedAt,
    adminSubmittedByName: record.adminSubmittedByName,
    adminSubmittedAt: record.adminSubmittedAt,
    fields,
    staffTotal: record.summaryTotal,
    zReportTotal: record.zReportTotal,
    totalVariance: record.difference,
    adminNotes: record.adminNotes,
  });
});
