import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveDate } from "../lib/activeDate.js";
import { syncDailySummaryFields } from "../lib/dailySummarySync.js";

export const lotteryRouter = Router();

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

lotteryRouter.get("/", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = await getActiveDate();
  const record = await prisma.lotteryRecord.findUnique({ where: { date } });
  if (!record) return res.status(404).json({ message: "No lottery record found for today." });

  res.json({ id: record.lotteryRecordId, lotteryValue: record.lotteryValue, date: record.date });
});

async function assertNotCommitted(res: import("express").Response, date: Date): Promise<boolean> {
  const summary = await prisma.dailySummary.findUnique({ where: { date } });
  if (summary?.isCommitted) {
    res.status(409).json({ message: "Today has already been committed and can no longer be edited." });
    return false;
  }
  return true;
}

lotteryRouter.post("/", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = await getActiveDate();
  if (!(await assertNotCommitted(res, date))) return;

  const lotteryValue = toNumber(req.body?.lotteryValue);
  const record = await prisma.lotteryRecord.upsert({
    where: { date },
    create: { date, lotteryValue },
    update: { lotteryValue },
  });
  await syncDailySummaryFields(date, { lotteryValue });

  res.json({ id: record.lotteryRecordId, lotteryValue: record.lotteryValue, date: record.date });
});

lotteryRouter.put("/:id", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = await getActiveDate();
  if (!(await assertNotCommitted(res, date))) return;

  const lotteryValue = toNumber(req.body?.lotteryValue);
  const record = await prisma.lotteryRecord.update({
    where: { lotteryRecordId: Number(req.params.id) },
    data: { lotteryValue },
  });
  await syncDailySummaryFields(record.date, { lotteryValue });

  res.json({ id: record.lotteryRecordId, lotteryValue: record.lotteryValue, date: record.date });
});
