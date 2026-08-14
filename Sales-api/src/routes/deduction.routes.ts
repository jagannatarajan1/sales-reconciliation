import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveContext } from "../lib/activeDate.js";
import { syncDailySummaryFields } from "../lib/dailySummarySync.js";
import { evaluateAndNotify } from "../lib/shiftReconciliation.js";

export const deductionRouter = Router();

const FIELDS = [
  "cashback",
  "paypointPayout",
  "instantLotteryPayout",
  "lotteryPayout",
  "newsVoucher",
  "ddPoint",
] as const;

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

deductionRouter.get("/today", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const { date, shift } = await getActiveContext();
  const record = await prisma.deduction.findUnique({ where: { date_shift: { date, shift } } });
  if (!record) return res.status(404).json({ message: "No deductions found for today." });

  res.json(record);
});

deductionRouter.post("/", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const { date, shift } = await getActiveContext();
  const body = req.body ?? {};
  const fieldData = Object.fromEntries(FIELDS.map((k) => [k, toNumber(body[k])]));

  const record = await prisma.deduction.upsert({
    where: { date_shift: { date, shift } },
    create: { date, shift, ...fieldData },
    update: { ...fieldData },
  });

  await syncDailySummaryFields(date, shift, fieldData);
  void evaluateAndNotify(date, shift);

  res.json(record);
});
