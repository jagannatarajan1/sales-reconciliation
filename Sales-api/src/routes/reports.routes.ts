import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { dateOnly } from "../lib/activeDate.js";

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
