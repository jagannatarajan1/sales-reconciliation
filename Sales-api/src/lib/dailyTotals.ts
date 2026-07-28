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

export async function computeDailyTotals(date: Date): Promise<DailyTotals> {
  const [summary, invoices, inventory] = await Promise.all([
    prisma.dailySummary.findUnique({ where: { date }, include: { creditCardEntries: true } }),
    prisma.supplierInvoice.findMany({ where: { date } }),
    prisma.instantLotteryInventoryEntry.findMany({ where: { date } }),
  ]);

  const manualCardAmount = (summary?.creditCardEntries ?? []).reduce((s, e) => s + Number(e.manualCardAmount), 0);
  const cardAmount = (summary?.creditCardEntries ?? []).reduce((s, e) => s + Number(e.cardAmount), 0);
  const supplierInvoicesTotal = invoices.reduce((s, i) => s + Number(i.value), 0);
  const instantLotteryTotalCount = inventory.reduce((s, i) => s + i.totalSold, 0);
  const instantLotteryTotalSales = inventory.reduce((s, i) => s + Number(i.sales), 0);

  const lastSafe = Number(summary?.lastSafe ?? 0);
  const safeDropAmount = Number(summary?.safeDropAmount ?? 0);
  const cashback = Number(summary?.cashback ?? 0);
  const paypointPayout = Number(summary?.paypointPayout ?? 0);
  const instantLotteryPayout = Number(summary?.instantLotteryPayout ?? 0);
  const lotteryPayout = Number(summary?.lotteryPayout ?? 0);
  const newsVoucher = Number(summary?.newsVoucher ?? 0);
  const ddPoint = Number(summary?.ddPoint ?? 0);
  const lotteryValue = Number(summary?.lotteryValue ?? 0);
  const paypointValue = Number(summary?.paypointValue ?? 0);

  const summaryTotal =
    manualCardAmount +
    cardAmount +
    lastSafe +
    safeDropAmount +
    instantLotteryTotalSales +
    lotteryValue +
    paypointValue +
    supplierInvoicesTotal +
    cashback +
    paypointPayout +
    instantLotteryPayout +
    lotteryPayout +
    newsVoucher +
    ddPoint;

  return {
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
  };
}
