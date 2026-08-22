import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveContext } from "../lib/activeDate.js";
import { blockIfLocked, blockIfPriorShiftPending } from "../lib/entryLock.js";
import { syncDailySummaryFields } from "../lib/dailySummarySync.js";
import { evaluateAndNotify } from "../lib/shiftReconciliation.js";

export const lotteryRouter = Router();

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

lotteryRouter.get("/", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const { date, shift } = await getActiveContext();
  const record = await prisma.lotteryRecord.findUnique({ where: { date_shift: { date, shift } } });
  if (!record) return res.status(404).json({ message: "No lottery record found for today." });

  res.json({ id: record.lotteryRecordId, lotteryValue: record.lotteryValue, date: record.date });
});

lotteryRouter.post("/", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const { date, shift } = await getActiveContext();
  if (await blockIfLocked(res, date, shift)) return;
  if (await blockIfPriorShiftPending(res, date, shift)) return;
  const lotteryValue = toNumber(req.body?.lotteryValue);
  const record = await prisma.lotteryRecord.upsert({
    where: { date_shift: { date, shift } },
    create: { date, shift, lotteryValue },
    update: { lotteryValue },
  });
  await syncDailySummaryFields(date, shift, { lotteryValue });
  void evaluateAndNotify(date, shift);

  res.json({ id: record.lotteryRecordId, lotteryValue: record.lotteryValue, date: record.date });
});

lotteryRouter.put("/:id", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const lotteryValue = toNumber(req.body?.lotteryValue);

  // Locked against the EXISTING row's own (date, shift), not the active
  // context — this updates by id, so the row may belong to a session other
  // than the one the caller is currently working.
  const existing = await prisma.lotteryRecord.findUnique({
    where: { lotteryRecordId: Number(req.params.id) },
  });
  if (!existing) return res.status(404).json({ message: "Record not found." });
  if (await blockIfLocked(res, existing.date, existing.shift)) return;
  if (await blockIfPriorShiftPending(res, existing.date, existing.shift)) return;

  const record = await prisma.lotteryRecord.update({
    where: { lotteryRecordId: existing.lotteryRecordId },
    data: { lotteryValue },
  });
  await syncDailySummaryFields(record.date, record.shift, { lotteryValue });
  void evaluateAndNotify(record.date, record.shift);

  res.json({ id: record.lotteryRecordId, lotteryValue: record.lotteryValue, date: record.date });
});
