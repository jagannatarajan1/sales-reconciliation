import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { dateOnly } from "../lib/activeDate.js";
import { computeDailyTotals } from "../lib/dailyTotals.js";
import { parseDepartmentTotal } from "../lib/departmentTotal.js";
import {
  renderReconciliationReportPdf,
  renderShiftReportPdf,
  renderDailyReconciliationPdf,
  ShiftReportPdfInput,
} from "../lib/pdf.js";
import { sendCommitNotificationEmail } from "../lib/commitEmail.js";
import { buildZReportBillsZip } from "../lib/zReportBills.js";
import * as gmailService from "../services/gmail.service.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/auditLog.js";
import { isWithinTolerance } from "../lib/variance.js";
import {
  applyAdminEdit,
  resolveShift,
  evaluateDay,
  getShiftBreakdown,
  getStatusCalendar,
  forceUnlockNightShift,
} from "../lib/shiftReconciliation.js";
import { Shift } from "@prisma/client";

export const adminReconciliationRouter = Router();

function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  return requirePermission(req, res, "commitHistory");
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

type ShiftReconciliationRow = Awaited<ReturnType<typeof prisma.shiftReconciliation.findMany>>[number];

function shiftDto(row: ShiftReconciliationRow) {
  return {
    shift: row.shift,
    originalTotal: row.originalTotal,
    xReportCount: row.xReportCount,
    staffEnteredTotal: row.staffEnteredTotal,
    staffEnteredByName: row.staffEnteredByName,
    staffEnteredAt: row.staffEnteredAt,
    adminEditedTotal: row.adminEditedTotal,
    adminEditedByName: row.adminEditedByName,
    adminEditedAt: row.adminEditedAt,
    adminEditReason: row.adminEditReason,
    finalTotal: row.finalTotal,
    originalDifference: row.originalDifference,
    finalDifference: row.finalDifference,
    originalStatus: row.originalStatus,
    finalStatus: row.finalStatus,
    hasEntries: row.hasEntries,
  };
}

adminReconciliationRouter.get("/pending", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const [allDays, records, allShiftRows] = await Promise.all([
    prisma.dailySummary.findMany({ orderBy: { date: "desc" } }),
    prisma.reconciliationRecord.findMany(),
    prisma.shiftReconciliation.findMany({ where: { shift: { in: [Shift.DAY, Shift.NIGHT] } } }),
  ]);
  // Only records that actually went through staff commit or admin sign-off
  // count as "already handled" here. A ReconciliationRecord can also get
  // written by pure X/Z-report evaluation with a default difference of 0
  // and neither flag set — if that row were allowed into this map, its
  // `!record` branch below would never fire and the day would silently
  // vanish from the pending queue despite never having been reviewed.
  const recordsByDate = new Map(
    records
      .filter((r) => r.isStaffCommitted || r.isAdminReconciled)
      .map((r) => [r.date.toISOString(), r])
  );
  // Unfiltered lookup, separate from the above — used only to read the
  // xFinal*/xVsZDifference snapshot evaluateDay writes, which can exist on a
  // day that has neither been staff-committed nor admin-reconciled yet.
  const anyRecordByDate = new Map(records.map((r) => [r.date.toISOString(), r]));

  const shiftsByDate = new Map<string, (typeof allShiftRows)[number][]>();
  for (const row of allShiftRows) {
    const key = row.date.toISOString();
    const group = shiftsByDate.get(key);
    if (group) group.push(row);
    else shiftsByDate.set(key, [row]);
  }

  // DailySummary now has up to one row per shift (DAY/NIGHT, or a single
  // FULL_DAY row for anything predating the split) for the same date — group
  // back down to one entry per day before iterating, or a day with both
  // shifts entered would render as two identical-looking pending items.
  const daysByDate = new Map<string, (typeof allDays)[number][]>();
  for (const day of allDays) {
    const key = day.date.toISOString();
    const group = daysByDate.get(key);
    if (group) group.push(day);
    else daysByDate.set(key, [day]);
  }

  const items = [];
  for (const [dateKey, dayRows] of daysByDate) {
    const record = recordsByDate.get(dateKey);
    const date = dayRows[0].date;

    const shifts = (shiftsByDate.get(dateKey) ?? []).map(shiftDto);
    const anyShiftVariance = shifts.some((s) => s.finalStatus === "VARIANCE");

    const anyRecord = anyRecordByDate.get(dateKey);
    // zReportTotal is deliberately NOT read from anyRecord.zReportTotal —
    // that's a separate, legacy column written only by the day-level
    // commit/submit flow (POST /Summary/commit, POST /admin/reconciliation/
    // submit) and can disagree with the Z-Report value xVsZDifference was
    // actually computed against by evaluateDay, producing a zReportTotal
    // that doesn't reconcile with the displayed difference (see
    // getShiftBreakdown's identical fix). Derived algebraically instead —
    // xFinalSumTotal and xVsZDifference are written atomically together by
    // the same evaluateDay upsert, so they're always mutually consistent,
    // and this avoids an evaluateDay call per pending row (N+1).
    const xVsZ =
      anyRecord?.xVsZDifference != null && anyRecord.xFinalSumTotal != null
        ? {
            xDay: anyRecord.xFinalDayTotal,
            xNight: anyRecord.xFinalNightTotal,
            xSum: anyRecord.xFinalSumTotal,
            zReportTotal: Math.round((Number(anyRecord.xFinalSumTotal) - Number(anyRecord.xVsZDifference)) * 100) / 100,
            difference: anyRecord.xVsZDifference,
            inTolerance: isWithinTolerance(Number(anyRecord.xVsZDifference)),
          }
        : null;
    const xVsZOutOfTolerance = xVsZ != null && !xVsZ.inTolerance;

    // No committed record at all -> always pending.
    if (!record) {
      const totals = await computeDailyTotals(date);
      let zReportTotal = 0;
      try {
        const email = await gmailService.findZReportEmail(date);
        const parsed = email ? parseDepartmentTotal(email.body) : null;
        if (parsed != null) zReportTotal = parsed;
      } catch {
        // Best-effort pre-fill only — fall back to 0 so the admin can still
        // type the value in by hand, exactly as before.
      }
      const difference = Math.abs(totals.summaryTotal - zReportTotal);

      // Represent the day with whichever shift's row was touched most
      // recently — the closest equivalent to the old single-row "who last
      // edited this day" now that there can be more than one row.
      const latestRow = dayRows.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));

      items.push({
        date: dateKey.split("T")[0],
        ...totals,
        zReportTotal,
        difference,
        staffNotes: latestRow.staffNotes ?? null,
        isStaffCommitted: false,
        lastEditedByName: latestRow.lastEditedByName ?? null,
        lastEditedAt: latestRow.updatedAt,
        shifts,
        xVsZ,
      });
      continue;
    }

    // A record exists. The ORIGINAL rule: keep showing up here only if not
    // yet signed off by admin AND the day-level variance is over tolerance.
    // WIDENED: a day also stays pending if a shift is individually flagged
    // VARIANCE, or the X-vs-Z check disagrees — either can be true
    // independently of the day-level summary-vs-Z figure the admin already
    // reconciled, and each has its own dedicated resolution action.
    const dayLevelPending = !record.isAdminReconciled && !isWithinTolerance(Number(record.difference));
    if (!dayLevelPending && !anyShiftVariance && !xVsZOutOfTolerance) continue;

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
      shifts,
      xVsZ,
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

  void evaluateDay(date);

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

// Full DAY/NIGHT + Z breakdown for a single date, for the admin Calendar
// tab's drill-down — the admin-only counterpart to the staff-safe
// GET /Summary/shift-status. Reuses getShiftBreakdown verbatim (full
// ShiftBreakdownDto fields including admin attribution, plus xVsZ with the
// actual Z-Report total) since this route is already gated on "commitHistory".
adminReconciliationRouter.get("/day/:date", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const date = dateOnly(req.params.date);
  const breakdown = await getShiftBreakdown(date);
  res.json({ date: date.toISOString().split("T")[0], ...breakdown });
});

// Per-date DAY/NIGHT/Z status rollup for the admin Calendar tab's month
// grid. Same getStatusCalendar helper GET /Summary/shift-calendar uses, but
// unstripped — zStatus (and therefore the fact that a Z variance exists) is
// admin-only information.
adminReconciliationRouter.get("/calendar", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const fromParam = req.query.fromDate as string | undefined;
  const toParam = req.query.toDate as string | undefined;
  if (!fromParam || !toParam) {
    return res.status(400).json({ message: "fromDate and toDate query parameters are required." });
  }

  const dates = await getStatusCalendar(dateOnly(fromParam), dateOnly(toParam));
  res.json({ dates });
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

// Maps one shift's stored row onto the PDF input. Kept next to the endpoints
// that use it rather than in pdf.ts, so the renderer stays ignorant of Prisma.
function toShiftPdfInput(
  date: Date,
  shift: Shift,
  row: {
    originalTotal: unknown; xReportCount: number;
    staffEnteredTotal: unknown; staffEnteredByName: string | null; staffEnteredAt: Date | null;
    adminEditedTotal: unknown; adminEditedByName: string | null; adminEditedAt: Date | null;
    adminEditReason: string | null;
    finalTotal: unknown; originalDifference: unknown; finalDifference: unknown;
    finalStatus: string;
    shiftCommittedByName: string | null; shiftCommittedAt: Date | null; shiftStaffNotes: string | null;
  } | null
): ShiftReportPdfInput {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    date,
    shiftLabel: shift === Shift.DAY ? "Day Shift" : shift === Shift.NIGHT ? "Night Shift" : "Full Day",
    originalTotal: num(row?.originalTotal),
    xReportCount: row?.xReportCount ?? 0,
    staffEnteredTotal: num(row?.staffEnteredTotal),
    staffEnteredByName: row?.staffEnteredByName ?? null,
    staffEnteredAt: row?.staffEnteredAt ?? null,
    adminEditedTotal: num(row?.adminEditedTotal),
    adminEditedByName: row?.adminEditedByName ?? null,
    adminEditedAt: row?.adminEditedAt ?? null,
    adminEditReason: row?.adminEditReason ?? null,
    finalTotal: num(row?.finalTotal),
    originalDifference: num(row?.originalDifference),
    finalDifference: num(row?.finalDifference),
    finalStatus: row?.finalStatus ?? "PENDING",
    committedByName: row?.shiftCommittedByName ?? null,
    committedAt: row?.shiftCommittedAt ?? null,
    staffNotes: row?.shiftStaffNotes ?? null,
  };
}

// One shift's X-Report chain as a PDF.
adminReconciliationRouter.get("/download-shift", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const dateParam = req.query.date as string | undefined;
  const shiftParam = req.query.shift as string | undefined;
  if (!dateParam) return res.status(400).json({ message: "date query parameter is required." });
  if (shiftParam !== Shift.DAY && shiftParam !== Shift.NIGHT) {
    return res.status(400).json({ message: "shift must be DAY or NIGHT." });
  }

  const date = dateOnly(dateParam);
  const row = await prisma.shiftReconciliation.findUnique({
    where: { date_shift: { date, shift: shiftParam } },
  });
  if (!row) {
    return res.status(404).json({ message: "No shift reconciliation found for this date and shift." });
  }

  const pdf = await renderShiftReportPdf(toShiftPdfInput(date, shiftParam, row), {
    generatedByName: req.userName,
  });
  const dateStr = date.toISOString().split("T")[0];
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="x-report-${shiftParam.toLowerCase()}-${dateStr}.pdf"`
  );
  res.send(pdf);
});

// The whole day: both shifts, corrections, combined X, Z, and the comparison.
adminReconciliationRouter.get("/download-daily", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const dateParam = req.query.date as string | undefined;
  if (!dateParam) return res.status(400).json({ message: "date query parameter is required." });

  const date = dateOnly(dateParam);

  const [dayRow, nightRow, record] = await Promise.all([
    prisma.shiftReconciliation.findUnique({ where: { date_shift: { date, shift: Shift.DAY } } }),
    prisma.shiftReconciliation.findUnique({ where: { date_shift: { date, shift: Shift.NIGHT } } }),
    prisma.reconciliationRecord.findUnique({ where: { date } }),
  ]);

  if (!dayRow && !nightRow && !record) {
    return res.status(404).json({ message: "Nothing recorded for this date." });
  }

  // evaluateDay is the single writer of the X-vs-Z figures and returns them,
  // so calling it here keeps the PDF consistent with the dashboard instead of
  // recomputing the comparison a second, divergent way.
  const { xFinalDayTotal, xFinalNightTotal, xFinalSumTotal, xVsZDifference, zReportTotal } =
    await evaluateDay(date);

  const pdf = await renderDailyReconciliationPdf(
    {
      date,
      shifts: [
        toShiftPdfInput(date, Shift.DAY, dayRow),
        toShiftPdfInput(date, Shift.NIGHT, nightRow),
      ],
      xDay: xFinalDayTotal,
      xNight: xFinalNightTotal,
      xSum: xFinalSumTotal,
      zReportTotal,
      xVsZDifference,
      inTolerance: xVsZDifference == null || isWithinTolerance(xVsZDifference),
      record,
    },
    { generatedByName: req.userName }
  );

  const dateStr = date.toISOString().split("T")[0];
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="daily-reconciliation-${dateStr}.pdf"`);
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

function parseShift(value: unknown): Shift | null {
  return value === "DAY" ? Shift.DAY : value === "NIGHT" ? Shift.NIGHT : null;
}

// Admin correction of a shift's X-Report reconciliation — an approved
// adjustment, never an overwrite of the till's original figure (see
// applyAdminEdit's doc comment). Authorization comes entirely from the
// authenticated token (req.userId/req.userName via requirePermission) —
// nothing in the request body is trusted for identity, only the corrected
// total and the reason.
adminReconciliationRouter.post("/shift/edit", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const body = req.body ?? {};
  const shift = parseShift(body.shift);
  if (!body.date || !shift) {
    return res.status(400).json({ message: "date and shift ('DAY' or 'NIGHT') are required." });
  }
  const total = Number(body.adminEditedTotal);
  if (!Number.isFinite(total)) {
    return res.status(400).json({ message: "adminEditedTotal must be a number." });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return res.status(400).json({ message: "A reason is required to correct an X-Report total." });
  }
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = dateOnly(body.date);
  const before = await prisma.shiftReconciliation.findUnique({ where: { date_shift: { date, shift } } });

  const updated = await applyAdminEdit(date, shift, {
    total,
    reason,
    userId: req.userId,
    userName: req.userName ?? null,
  });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "shift_reconciliation_admin_edit",
    entity: "ShiftReconciliation",
    entityId: updated.shiftReconciliationId,
    previousValue: before,
    newValue: updated,
  });

  res.json(updated);
});

// Admin safety valve for the Day→Night prior-shift gate (see
// isPriorShiftPending in lib/entryLock.ts): for the real-world case where Day
// staff forgot to submit, or are unavailable, and Night genuinely needs to
// start entering figures before Day is actually done. Requires an explicit
// reason and is fully audited — this must never happen silently or
// automatically.
//
// Deliberately does NOT go through the same write path as a genuine staff
// shift-commit (POST /Summary/shift-commit): forceUnlockNightShift never
// stamps shiftCommittedByUserId/shiftCommittedByName/shiftCommittedAt, so a
// forced-open Day row can never be mistaken for a real staff submission just
// by looking at those columns. The distinguishing record — who forced it
// open, when, and why — lives in the audit log entry below, under its own
// action name (admin_force_unlock_night_shift) rather than reusing
// "shift_commit" or "shift_reconciliation_admin_edit".
adminReconciliationRouter.post("/shift/force-unlock-night", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const body = req.body ?? {};
  if (!body.date) {
    return res.status(400).json({ message: "date is required." });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return res.status(400).json({ message: "A reason is required to force-unlock the Night shift." });
  }

  const date = dateOnly(body.date);
  const before = await prisma.shiftReconciliation.findUnique({ where: { date_shift: { date, shift: Shift.DAY } } });

  const { row: updated, forced } = await forceUnlockNightShift(date);

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "admin_force_unlock_night_shift",
    entity: "ShiftReconciliation",
    entityId: updated.shiftReconciliationId,
    previousValue: before,
    newValue: { ...updated, reason, forced },
  });

  res.json({
    message: forced
      ? "Night shift entry has been unlocked. The Day shift for this date is still not staff-submitted — this was an admin override, and is recorded as such."
      : "The Day shift for this date is already committed, so Night entry was already unlocked. No change was made.",
    date: date.toISOString().split("T")[0],
    forced,
    waitingOnDayShift: false,
  });
});

adminReconciliationRouter.post("/shift/resolve", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const body = req.body ?? {};
  const shift = parseShift(body.shift);
  if (!body.date || !shift) {
    return res.status(400).json({ message: "date and shift ('DAY' or 'NIGHT') are required." });
  }

  const date = dateOnly(body.date);
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  const updated = await resolveShift(date, shift, notes);

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "shift_reconciliation_resolve",
    entity: "ShiftReconciliation",
    entityId: updated.shiftReconciliationId,
    newValue: updated,
  });

  res.json(updated);
});
