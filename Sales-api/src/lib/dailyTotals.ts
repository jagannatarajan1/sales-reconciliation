import { Shift } from "@prisma/client";
import { prisma } from "./prisma.js";

export interface DailyTotals {
  manualCardAmount: number;
  cardAmount: number;
  lastSafe: number;
  safeDropAmount: number;
  cashback: number;
  paypointPayout: number;
  instantLotteryPayout: number;
  lotteryPayout: number;
  newsVoucher: number;
  ddPoint: number;
  supplierInvoicesTotal: number;
  instantLotteryTotalCount: number;
  instantLotteryTotalSales: number;
  lotteryValue: number;
  paypointValue: number;
  summaryTotal: number;
}

function sumFields(summaries: { [key: string]: unknown }[], keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    out[key] = summaries.reduce((s, row) => s + Number(row[key] ?? 0), 0);
  }
  return out;
}

const SUMMARY_MONEY_KEYS = [
  "lastSafe",
  "safeDropAmount",
  "cashback",
  "paypointPayout",
  "instantLotteryPayout",
  "lotteryPayout",
  "newsVoucher",
  "ddPoint",
  "lotteryValue",
  "paypointValue",
] as const;

// Every DailySummary row already carried these meanings as per-shift-worth-
// of-a-day figures even before the shift split (there was just only ever one
// row per date). lastSafe/safeDropAmount are confirmed flows (cash banked
// during the shift, not a running balance), so summing every shift's row is
// the same operation as before — a FULL_DAY row is just a sum of one.
function sumDailySummaryRows(rows: { [key: string]: unknown }[]) {
  return sumFields(rows, [...SUMMARY_MONEY_KEYS]) as unknown as Record<(typeof SUMMARY_MONEY_KEYS)[number], number>;
}

// The whole-day totals — UNCHANGED signature and meaning from before the
// shift split. Every existing caller (reports.routes.ts, pdf.ts, excel.ts,
// the commit flow, adminReconciliation.routes.ts) keeps working unmodified:
// this is now the sum of every shift's DailySummary row (DAY + NIGHT, or a
// single FULL_DAY row for any date that predates the split) rather than a
// single row read directly.
export async function computeDailyTotals(date: Date): Promise<DailyTotals> {
  const [summaries, invoices, inventory] = await Promise.all([
    prisma.dailySummary.findMany({ where: { date }, include: { creditCardEntries: true } }),
    prisma.supplierInvoice.findMany({ where: { date } }),
    prisma.instantLotteryInventoryEntry.findMany({ where: { date } }),
  ]);

  const creditCardEntries = summaries.flatMap((s) => s.creditCardEntries);
  const manualCardAmount = creditCardEntries.reduce((s, e) => s + Number(e.manualCardAmount), 0);
  const cardAmount = creditCardEntries.reduce((s, e) => s + Number(e.cardAmount), 0);
  const supplierInvoicesTotal = invoices.reduce((s, i) => s + Number(i.value), 0);
  const instantLotteryTotalCount = inventory.reduce((s, i) => s + i.totalSold, 0);
  const instantLotteryTotalSales = inventory.reduce((s, i) => s + Number(i.sales), 0);

  const summaryFields = sumDailySummaryRows(summaries);

  const summaryTotal =
    manualCardAmount +
    cardAmount +
    summaryFields.lastSafe +
    summaryFields.safeDropAmount +
    instantLotteryTotalSales +
    summaryFields.lotteryValue +
    summaryFields.paypointValue +
    supplierInvoicesTotal +
    summaryFields.cashback +
    summaryFields.paypointPayout +
    summaryFields.instantLotteryPayout +
    summaryFields.lotteryPayout +
    summaryFields.newsVoucher +
    summaryFields.ddPoint;

  return {
    manualCardAmount,
    cardAmount,
    ...summaryFields,
    supplierInvoicesTotal,
    instantLotteryTotalCount,
    instantLotteryTotalSales,
    summaryTotal,
  };
}

// The single-shift equivalent of computeDailyTotals — same shape, same
// formula, just scoped to one (date, shift) instead of summed across all of
// them. This is what the per-shift reconciliation (evaluateShift) compares
// against each shift's X-Report total.
export async function computeShiftTotals(date: Date, shift: Shift): Promise<DailyTotals> {
  const [summary, invoices, inventory] = await Promise.all([
    prisma.dailySummary.findUnique({ where: { date_shift: { date, shift } }, include: { creditCardEntries: true } }),
    prisma.supplierInvoice.findMany({ where: { date, shift } }),
    prisma.instantLotteryInventoryEntry.findMany({ where: { date, shift } }),
  ]);

  const manualCardAmount = (summary?.creditCardEntries ?? []).reduce((s, e) => s + Number(e.manualCardAmount), 0);
  const cardAmount = (summary?.creditCardEntries ?? []).reduce((s, e) => s + Number(e.cardAmount), 0);
  const supplierInvoicesTotal = invoices.reduce((s, i) => s + Number(i.value), 0);
  const instantLotteryTotalCount = inventory.reduce((s, i) => s + i.totalSold, 0);
  const instantLotteryTotalSales = inventory.reduce((s, i) => s + Number(i.sales), 0);

  const summaryFields = summary ? sumDailySummaryRows([summary]) : sumDailySummaryRows([]);

  const summaryTotal =
    manualCardAmount +
    cardAmount +
    summaryFields.lastSafe +
    summaryFields.safeDropAmount +
    instantLotteryTotalSales +
    summaryFields.lotteryValue +
    summaryFields.paypointValue +
    supplierInvoicesTotal +
    summaryFields.cashback +
    summaryFields.paypointPayout +
    summaryFields.instantLotteryPayout +
    summaryFields.lotteryPayout +
    summaryFields.newsVoucher +
    summaryFields.ddPoint;

  return {
    manualCardAmount,
    cardAmount,
    ...summaryFields,
    supplierInvoicesTotal,
    instantLotteryTotalCount,
    instantLotteryTotalSales,
    summaryTotal,
  };
}

// Explicit, stated chronology for "what shift's closeNo carries forward as
// this shift's openNo" — deliberately NOT `orderBy: [{date:'desc'},
// {shift:'desc'}]`, which would silently depend on Postgres enum ordinal
// order matching the Shift enum's declaration order in schema.prisma. A
// future reordering of that enum (e.g. adding a shift name alphabetically)
// would silently corrupt every totalSold/sales figure with no compile error
// to catch it. Instead the chronology is spelled out here: NIGHT's
// predecessor is the same date's DAY row; DAY's (and FULL_DAY's)
// predecessor is the latest-closing row on the most recent earlier date.
//
// "Latest-closing" matters because a boundary day can have BOTH a DAY and a
// NIGHT row for the same earlier date (the cutover day, or any day the split
// was active) — letting the DB pick an arbitrary one between them would
// reintroduce the exact enum-ordinal risk this function exists to avoid, so
// which one wins is spelled out explicitly (NIGHT closed last, then DAY,
// then FULL_DAY) rather than left to an ORDER BY on the shift column.
export async function previousShiftEntry(scratchCardId: number, date: Date, shift: Shift) {
  if (shift === Shift.NIGHT) {
    const sameDayPrevious = await prisma.instantLotteryInventoryEntry.findUnique({
      where: { scratchCardId_date_shift: { scratchCardId, date, shift: Shift.DAY } },
    });
    if (sameDayPrevious) return sameDayPrevious;
  }

  const mostRecentEarlier = await prisma.instantLotteryInventoryEntry.findFirst({
    where: { scratchCardId, date: { lt: date } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!mostRecentEarlier) return null;

  const rowsOnThatDate = await prisma.instantLotteryInventoryEntry.findMany({
    where: { scratchCardId, date: mostRecentEarlier.date },
  });

  return (
    rowsOnThatDate.find((r) => r.shift === Shift.NIGHT) ??
    rowsOnThatDate.find((r) => r.shift === Shift.DAY) ??
    rowsOnThatDate.find((r) => r.shift === Shift.FULL_DAY) ??
    null
  );
}
