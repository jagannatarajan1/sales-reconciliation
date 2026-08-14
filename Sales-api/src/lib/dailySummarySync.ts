import { Prisma, Shift } from "@prisma/client";
import { prisma } from "./prisma.js";

export async function syncDailySummaryFields(
  date: Date,
  shift: Shift,
  fields: Partial<Record<
    "cashback" | "paypointPayout" | "instantLotteryPayout" | "lotteryPayout" | "newsVoucher" | "ddPoint" |
    "lotteryValue" | "paypointValue",
    number
  >>
): Promise<void> {
  await prisma.dailySummary.upsert({
    where: { date_shift: { date, shift } },
    create: { date, shift, ...fields },
    update: { ...fields },
  });
}

export function decToNum(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}
