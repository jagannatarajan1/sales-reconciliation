import { Shift, TillReportType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { dateOnly } from "./activeDate.js";
import { aggregateShift, toRawReport, CHILD_INCLUDE } from "./tillReportReconciliation.js";

// ─────────────────────────────────────────────────────────────────────────
// Staff-facing view of ONE shift's own X-Report data — its own contents,
// never a comparison against anything else. This is a different, narrower
// question from tillReportReconciliation.ts's reconcileDay (which compares
// Day X + Night X against the Z-Report, admin-only). This module reuses
// aggregateShift/toRawReport/CHILD_INCLUDE from that file so the "sum
// multiple X-Report reprints for one shift" logic is never duplicated, but
// the Prisma query itself only ever asks for reportType: X_REPORT at an
// exact (businessDate, shift) — there is no code path here that could ever
// return Z-Report rows or the other shift's rows, structurally, not just by
// convention.
//
// Mirrors the "Z-blind, own-shift-scoped" precedent already established by
// getStaffShiftBreakdown in shiftReconciliation.ts. `date`/`shift` must come
// from the caller's own session context (see GET /Summary/my-shift-report in
// summary.routes.ts, which calls getActiveContext() — never a client-supplied
// query param) so a staff member cannot request another date or shift.
// ─────────────────────────────────────────────────────────────────────────

export interface StaffDepartmentLine {
  name: string;
  amount: number;
  category: "MERCHANDISE" | "LOTTERY_GROUP";
}

export interface StaffVatLine {
  code: string;
  salesExVat: number;
  vat: number;
  salesInVat: number;
}

export interface StaffVoidLine {
  type: string;
  occurredAt: string; // ISO
  amount: number;
}

export interface StaffProductLine {
  departmentName: string;
  productName: string;
  salesQuantity: number;
}

export interface StaffShiftTotals {
  cash: number | null;
  card: number | null;
  manualCard: number | null;
  grandTotal: number | null;
  transactionCount: number | null;
  incomeExpenseTotal: number | null;
}

export interface StaffOwnShiftReportUnavailable {
  available: false;
  message: string;
}

export interface StaffOwnShiftReportNoData {
  available: true;
  hasReport: false;
  message: string;
}

export interface StaffOwnShiftReportData {
  available: true;
  hasReport: true;
  // How many X-Report copies (including reprints) were summed into this
  // view — mirrors reportPresence.count on the admin comparison, surfaced
  // here mainly so a "printed twice" oddity is visible rather than silent.
  reportCount: number;
  departments: StaffDepartmentLine[];
  vat: StaffVatLine[];
  totals: StaffShiftTotals;
  voids: StaffVoidLine[];
  products: StaffProductLine[];
}

// Deliberately NO s1/s2/expected/actual/variance/status/comparison fields
// anywhere in this type — that is the safety property this module exists to
// preserve. See the module doc comment above.
export type StaffOwnShiftReport = StaffOwnShiftReportUnavailable | StaffOwnShiftReportNoData | StaffOwnShiftReportData;

const FULL_DAY_MESSAGE = "Shift reports aren't available while shift entry is turned off for the store.";
const NO_REPORT_MESSAGE = "No till report has been received yet for your shift.";

/**
 * Staff's own view of the till's X-Report(s) for `date`/`shift`. Never
 * queries Z-Report rows, never queries the other shift, never takes a
 * client-supplied date or shift — see the module doc comment.
 */
export async function getStaffOwnShiftReport(date: Date, shift: Shift): Promise<StaffOwnShiftReport> {
  // FULL_DAY is the legacy no-shift-split bucket — till reports are never
  // classified FULL_DAY (they are always DAY/NIGHT, see tillReportIngest.ts),
  // so there is no "shift's own X-Report" concept to show while the split is
  // off. Checked first so this never runs a query for it.
  if (shift === Shift.FULL_DAY) {
    return { available: false, message: FULL_DAY_MESSAGE };
  }

  const d = dateOnly(date);

  const reports = await prisma.tillReport.findMany({
    where: { businessDate: d, reportType: TillReportType.X_REPORT, shift },
    include: CHILD_INCLUDE,
    orderBy: { printedAt: "asc" },
  });

  if (reports.length === 0) {
    return { available: true, hasReport: false, message: NO_REPORT_MESSAGE };
  }

  const agg = aggregateShift(reports.map(toRawReport));

  const departments: StaffDepartmentLine[] = [...agg.departmentTotals.entries()]
    .map(([name, v]) => ({ name, amount: v.amount, category: v.category }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const vat: StaffVatLine[] = [...agg.vatTotals.entries()]
    .map(([code, v]) => ({ code, salesExVat: v.salesExVat, vat: v.vat, salesInVat: v.salesInVat }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const products: StaffProductLine[] = [...agg.productTotals.entries()]
    .map(([productName, v]) => ({ departmentName: v.departmentName, productName, salesQuantity: v.salesQuantity }))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  // Void lines are discrete events, not summed — same reasoning as
  // aggregateShift's own doc comment on why it just concatenates them.
  const voids: StaffVoidLine[] = agg.voidLines
    .map((v) => ({ type: v.type, occurredAt: v.occurredAt.toISOString(), amount: v.amount }))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return {
    available: true,
    hasReport: true,
    reportCount: agg.count,
    departments,
    vat,
    totals: {
      cash: agg.cashTotal,
      card: agg.cardTotal,
      manualCard: agg.manualCardTotal,
      grandTotal: agg.grandTotal,
      transactionCount: agg.transactionCount,
      incomeExpenseTotal: agg.incomeExpenseTotal,
    },
    voids,
    products,
  };
}
