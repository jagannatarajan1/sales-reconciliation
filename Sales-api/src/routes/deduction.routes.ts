import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveDate } from "../lib/activeDate.js";
import { syncDailySummaryFields } from "../lib/dailySummarySync.js";

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

  const date = await getActiveDate();
  const record = await prisma.deduction.findUnique({ where: { date } });
  if (!record) return res.status(404).json({ message: "No deductions found for today." });

  res.json(record);
});

deductionRouter.post("/", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const date = await getActiveDate();
  const summary = await prisma.dailySummary.findUnique({ where: { date } });
  if (summary?.isCommitted) {
    return res.status(409).json({ message: "Today has already been committed and can no longer be edited." });
  }

  const body = req.body ?? {};
  const fieldData = Object.fromEntries(FIELDS.map((k) => [k, toNumber(body[k])]));

  const record = await prisma.deduction.upsert({
    where: { date },
    create: { date, ...fieldData },
    update: { ...fieldData },
  });

  await syncDailySummaryFields(date, fieldData);

  res.json(record);
});
