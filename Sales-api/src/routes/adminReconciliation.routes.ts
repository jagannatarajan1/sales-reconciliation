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
        isStaffCommitted: false,
        lastEditedByName: day.lastEditedByName ?? null,
        lastEditedAt: day.updatedAt,
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
      isStaffCommitted: record.isStaffCommitted,
      committedByName: record.committedByName ?? null,
      committedAt: record.committedAt ?? null,
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
  const adminNotes = body.adminNotes ? String(body.adminNotes) : null;

  // Z-Report Total is never client-editable — it always reflects the actual
  // Z-Report email, the same live lookup GET /pending uses to pre-fill this
  // figure. Whatever the request body sent for it is ignored, so a direct
  // API call can't override it any more than the (read-only) UI field can.
  let zReportTotal = 0;
  try {
    const email = await gmailService.findZReportEmail(date);
    const parsed = email ? parseDepartmentTotal(email.body) : null;
    if (parsed != null) zReportTotal = parsed;
  } catch {
    // Best-effort, same fallback-to-0 as GET /pending.
  }

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
// have actually committed it and/or admin has signed off. This also backs
// the "Recent Commits" quick-select chips on the frontend, which would
// otherwise be able to surface a date that was never really committed.
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
    adminSubmittedByName: record.adminSubmittedByName,
    adminSubmittedAt: record.adminSubmittedAt,
  });
});

// "Download Bill" — renders the full, properly formatted reconciliation
// report for the date, rather than the raw Z-report-email PDF. Admin-only,
// gated on "commitHistory".
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

// ─────────────────────────────────────────────────────────────────────────
// Unified, paginated record list backing the redesigned Reconciliation
// dashboard (table + KPI cards + filters). The rest of this router's
// endpoints (pending / committed / submit) are untouched and still power
// the drawer's edit-and-submit flow — this just adds the aggregate view
// none of them individually provide: every day in a range, uncommitted or
// not, with a single computed status/variance, sorted and paginated
// server-side so the frontend never has to fetch-everything-then-slice.
type RecordStatus = "uncommitted" | "needs_review" | "auto_matched" | "reconciled";

interface UnifiedRecord {
  date: string;
  status: RecordStatus;
  staffTotal: number;
  zReportTotal: number;
  variance: number;
  isStaffCommitted: boolean;
  isAdminReconciled: boolean;
  committedByName: string | null;
  committedAt: string | null;
  adminSubmittedByName: string | null;
  adminSubmittedAt: string | null;
  lastEditedByName: string | null;
  lastUpdated: string;
  staffNotes: string | null;
  adminNotes: string | null;
}

function daysAgoDate(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return dateOnly(d);
}

function computeRecordStatus(record: {
  isAdminReconciled: boolean;
  isStaffCommitted: boolean;
  difference: unknown;
}): RecordStatus {
  if (record.isAdminReconciled) return "reconciled";
  const variance = Math.abs(Number(record.difference));
  if (record.isStaffCommitted && variance <= VARIANCE_TOLERANCE) return "auto_matched";
  return "needs_review";
}

// Full single-date detail for the redesigned dashboard's drawer — works for
// any date regardless of status (unlike /committed/:date, which 404s for an
// uncommitted day). Same two data sources /records draws from, just for one
// date and with every editable field included, not just the table's columns.
adminReconciliationRouter.get("/day/:date", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const date = dateOnly(req.params.date);
  const record = await prisma.reconciliationRecord.findUnique({ where: { date } });

  if (record) {
    return res.json({
      date: record.date.toISOString().split("T")[0],
      status: computeRecordStatus(record),
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
      adminSubmittedByName: record.adminSubmittedByName,
      adminSubmittedAt: record.adminSubmittedAt,
      lastEditedByName: null,
      lastEditedAt: null,
    });
  }

  const day = await prisma.dailySummary.findUnique({ where: { date } });
  const totals = await computeDailyTotals(date);
  let zReportTotal = 0;
  try {
    const email = await gmailService.findZReportEmail(date);
    const parsed = email ? parseDepartmentTotal(email.body) : null;
    if (parsed != null) zReportTotal = parsed;
  } catch {
    // Best-effort pre-fill only, same fallback-to-0 as elsewhere.
  }
  const difference = Math.abs(totals.summaryTotal - zReportTotal);

  res.json({
    date: date.toISOString().split("T")[0],
    status: "uncommitted",
    ...totals,
    zReportTotal,
    difference,
    adminNotes: null,
    staffNotes: day?.staffNotes ?? null,
    isStaffCommitted: false,
    isAdminReconciled: false,
    committedByName: null,
    committedAt: null,
    adminSubmittedByName: null,
    adminSubmittedAt: null,
    lastEditedByName: day?.lastEditedByName ?? null,
    lastEditedAt: day?.updatedAt ?? null,
  });
});

adminReconciliationRouter.get("/records", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const toDate = req.query.toDate ? dateOnly(req.query.toDate as string) : dateOnly(new Date());
  const fromDate = req.query.fromDate ? dateOnly(req.query.fromDate as string) : daysAgoDate(90);

  const status = (req.query.status as string) || "all";
  const varianceBucket = (req.query.variance as string) || "all";
  const search = ((req.query.search as string) || "").trim().toLowerCase();
  const sortBy = (req.query.sortBy as string) || "date";
  const sortDir = (req.query.sortDir as string) === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

  const [days, records] = await Promise.all([
    prisma.dailySummary.findMany({ where: { date: { gte: fromDate, lte: toDate } } }),
    prisma.reconciliationRecord.findMany({ where: { date: { gte: fromDate, lte: toDate } } }),
  ]);

  const recordsByDate = new Map(records.map((r) => [r.date.toISOString(), r]));
  const daysByDate = new Map(days.map((d) => [d.date.toISOString(), d]));
  const allDates = new Map<string, Date>();
  for (const d of days) allDates.set(d.date.toISOString(), d.date);
  for (const r of records) allDates.set(r.date.toISOString(), r.date);

  const unified: UnifiedRecord[] = [];
  for (const [iso, date] of allDates) {
    const record = recordsByDate.get(iso);
    const dateStr = date.toISOString().split("T")[0];

    if (record) {
      const variance = Math.abs(Number(record.difference));

      unified.push({
        date: dateStr,
        status: computeRecordStatus(record),
        staffTotal: Number(record.summaryTotal),
        zReportTotal: Number(record.zReportTotal),
        variance,
        isStaffCommitted: record.isStaffCommitted,
        isAdminReconciled: record.isAdminReconciled,
        committedByName: record.committedByName ?? null,
        committedAt: record.committedAt?.toISOString() ?? null,
        adminSubmittedByName: record.adminSubmittedByName ?? null,
        adminSubmittedAt: record.adminSubmittedAt?.toISOString() ?? null,
        lastEditedByName: null,
        lastUpdated: record.updatedAt.toISOString(),
        staffNotes: record.staffNotes ?? null,
        adminNotes: record.adminNotes ?? null,
      });
      continue;
    }

    const day = daysByDate.get(iso);
    if (!day) continue; // record-only date with no DailySummary — nothing uncommitted to show

    const totals = await computeDailyTotals(day.date);
    let zReportTotal = 0;
    try {
      const email = await gmailService.findZReportEmail(day.date);
      const parsed = email ? parseDepartmentTotal(email.body) : null;
      if (parsed != null) zReportTotal = parsed;
    } catch {
      // Best-effort pre-fill only, same fallback-to-0 as elsewhere.
    }

    unified.push({
      date: dateStr,
      status: "uncommitted",
      staffTotal: totals.summaryTotal,
      zReportTotal,
      variance: Math.abs(totals.summaryTotal - zReportTotal),
      isStaffCommitted: false,
      isAdminReconciled: false,
      committedByName: null,
      committedAt: null,
      adminSubmittedByName: null,
      adminSubmittedAt: null,
      lastEditedByName: day.lastEditedByName ?? null,
      lastUpdated: day.updatedAt.toISOString(),
      staffNotes: day.staffNotes ?? null,
      adminNotes: null,
    });
  }

  let filtered = unified;
  if (status !== "all") filtered = filtered.filter((r) => r.status === status);
  if (varianceBucket !== "all") {
    filtered = filtered.filter((r) => {
      if (varianceBucket === "zero") return r.variance === 0;
      if (varianceBucket === "small") return r.variance > 0 && r.variance <= VARIANCE_TOLERANCE;
      if (varianceBucket === "large") return r.variance > VARIANCE_TOLERANCE;
      return true;
    });
  }
  if (search) {
    filtered = filtered.filter((r) =>
      r.date.includes(search) ||
      (r.committedByName ?? "").toLowerCase().includes(search) ||
      (r.adminSubmittedByName ?? "").toLowerCase().includes(search) ||
      (r.lastEditedByName ?? "").toLowerCase().includes(search) ||
      (r.staffNotes ?? "").toLowerCase().includes(search) ||
      (r.adminNotes ?? "").toLowerCase().includes(search),
    );
  }

  const todayStr = dateOnly(new Date()).toISOString().split("T")[0];
  const kpis = {
    totalReports: filtered.length,
    pendingReview: filtered.filter((r) => r.status === "needs_review").length,
    matched: filtered.filter((r) => r.status === "auto_matched").length,
    varianceFound: filtered.filter((r) => r.variance > 0).length,
    completedToday: filtered.filter(
      (r) => r.status === "reconciled" && (r.adminSubmittedAt ?? "").startsWith(todayStr),
    ).length,
    totalVarianceAmount: Math.round(filtered.reduce((sum, r) => sum + r.variance, 0) * 100) / 100,
  };

  type SortKey = "date" | "staffTotal" | "zReportTotal" | "variance" | "lastUpdated";
  const sortKey: SortKey =
    sortBy === "staffTotal" || sortBy === "zReportTotal" || sortBy === "variance" || sortBy === "lastUpdated"
      ? sortBy
      : "date";
  filtered = [...filtered].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = av === bv ? 0 : av < bv ? -1 : 1;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const total = filtered.length;
  const items = filtered.slice((page - 1) * pageSize, page * pageSize);

  res.json({ items, total, page, pageSize, kpis });
});

// Read-only activity feed for a single date, sourced from the same
// AuditLog table every commit/submit/edit action already writes to —
// nothing new is persisted here, this just exposes what's already recorded.
const ACTION_LABELS: Record<string, string> = {
  staff_commit: "Committed by staff",
  admin_reconciliation_submit: "Reviewed by admin",
};

adminReconciliationRouter.get("/audit-log/:date", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const dateStr = dateOnly(req.params.date).toISOString().split("T")[0];
  const entries = await prisma.auditLog.findMany({
    where: { entity: "ReconciliationRecord", entityId: dateStr },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    entries.map((e) => ({
      id: e.auditLogId,
      action: e.action,
      label: ACTION_LABELS[e.action] ?? e.action,
      userName: e.userName,
      createdAt: e.createdAt,
    })),
  );
});

// Bulk sign-off for the table's multi-select toolbar — approves each date's
// *existing* committed values as-is (no field changes, no re-derivation),
// so it's cheap for large selections and doesn't refire a notification
// email per date the way resubmitting each one through /submit would.
adminReconciliationRouter.post("/bulk-approve", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const dates = Array.isArray(req.body?.dates) ? (req.body.dates as unknown[]) : [];
  if (dates.length === 0) return res.status(400).json({ message: "dates array is required." });

  let approved = 0;
  let skipped = 0;
  for (const raw of dates) {
    const date = dateOnly(String(raw));
    const existing = await prisma.reconciliationRecord.findUnique({ where: { date } });
    if (!existing) {
      skipped++;
      continue;
    }

    await prisma.reconciliationRecord.update({
      where: { date },
      data: {
        isAdminReconciled: true,
        adminSubmittedByUserId: req.userId,
        adminSubmittedByName: req.userName ?? null,
        adminSubmittedAt: new Date(),
      },
    });

    void writeAuditLog({
      userId: req.userId,
      userName: req.userName,
      action: "admin_reconciliation_bulk_approve",
      entity: "ReconciliationRecord",
      entityId: date.toISOString().split("T")[0],
      previousValue: existing,
    });

    approved++;
  }

  res.json({ approved, skipped });
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
