import { Router } from "express";
import { dateOnly } from "../lib/activeDate.js";
import { ingestTillReports } from "../lib/tillReportIngest.js";
import { reconcileDay } from "../lib/tillReportReconciliation.js";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { TillReportType } from "@prisma/client";

// Backfill/inspection surface for the persisted TillReport table. Gated on
// "reports" — the same permission that already covers the Z-Reports admin
// page — since this is the same kind of read: browsing till emails, not
// touching reconciliation state.
export const adminTillReportsRouter = Router();

function requireReports(req: import("express").Request, res: import("express").Response): boolean {
  return requirePermission(req, res, "reports");
}

adminTillReportsRouter.get("/", async (req, res) => {
  if (!requireReports(req, res)) return;

  const fromParam = req.query.fromDate as string | undefined;
  const toParam = req.query.toDate as string | undefined;
  if (!fromParam || !toParam) {
    return res.status(400).json({ message: "fromDate and toDate query parameters are required." });
  }

  const fromDate = dateOnly(fromParam);
  const toDate = dateOnly(toParam);
  if (fromDate > toDate) return res.status(400).json({ message: "fromDate must be on or before toDate." });

  // toDate is inclusive on this endpoint (matches how every other range
  // endpoint in the app treats fromDate/toDate query params) — businessDate
  // is a plain @db.Date column so lte works directly, no +1 day needed.
  const reports = await prisma.tillReport.findMany({
    where: { businessDate: { gte: fromDate, lte: toDate } },
    orderBy: [{ businessDate: "asc" }, { printedAt: "asc" }],
  });

  res.json({ items: reports });
});

adminTillReportsRouter.post("/ingest", async (req, res) => {
  if (!requireReports(req, res)) return;

  const { fromDate: fromParam, toDate: toParam } = req.body ?? {};
  if (!fromParam || !toParam) {
    return res.status(400).json({ message: "fromDate and toDate are required." });
  }

  const fromDate = dateOnly(fromParam);
  // The scan window is exclusive on the "before" side (Gmail's `before:`
  // operator), so callers asking to backfill through toDate need +1 day to
  // actually include messages received on toDate itself.
  const toDate = dateOnly(toParam);
  const before = new Date(toDate);
  before.setDate(before.getDate() + 1);

  if (fromDate > toDate) return res.status(400).json({ message: "fromDate must be on or before toDate." });

  const result = await ingestTillReports(fromDate, before);
  res.json(result);
});

adminTillReportsRouter.get("/summary", async (req, res) => {
  if (!requireReports(req, res)) return;

  const [xCount, zCount] = await Promise.all([
    prisma.tillReport.count({ where: { reportType: TillReportType.X_REPORT } }),
    prisma.tillReport.count({ where: { reportType: TillReportType.Z_REPORT } }),
  ]);

  res.json({ xReportCount: xCount, zReportCount: zCount });
});

// POS-internal consistency check: does the till's own DAY X + NIGHT X data
// add up to its own Z-Report data for this date. Distinct from (and never
// writes to) the pre-existing till-vs-staff-banking check in
// shiftReconciliation.ts/ShiftReconciliation — see the doc comment atop
// tillReportReconciliation.ts. Read-only, computed fresh on every call.
adminTillReportsRouter.get("/reconcile/:date", async (req, res) => {
  if (!requireReports(req, res)) return;

  const date = dateOnly(req.params.date);
  const result = await reconcileDay(date);
  res.json(result);
});
