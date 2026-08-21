import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveContext } from "../lib/activeDate.js";
import { blockIfLocked } from "../lib/entryLock.js";
import { syncDailySummaryFields } from "../lib/dailySummarySync.js";
import { evaluateAndNotify } from "../lib/shiftReconciliation.js";

export const paypointRouter = Router();

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

paypointRouter.get("/", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const { date, shift } = await getActiveContext();
  const record = await prisma.paypointRecord.findUnique({ where: { date_shift: { date, shift } } });
  if (!record) return res.status(404).json({ message: "No paypoint record found for today." });

  res.json({ id: record.paypointRecordId, paypointValue: record.paypointValue, date: record.date });
});

paypointRouter.post("/", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const { date, shift } = await getActiveContext();
  if (await blockIfLocked(res, date, shift)) return;
  const paypointValue = toNumber(req.body?.paypointValue);
  const record = await prisma.paypointRecord.upsert({
    where: { date_shift: { date, shift } },
    create: { date, shift, paypointValue },
    update: { paypointValue },
  });
  await syncDailySummaryFields(date, shift, { paypointValue });
  void evaluateAndNotify(date, shift);

  res.json({ id: record.paypointRecordId, paypointValue: record.paypointValue, date: record.date });
});

paypointRouter.put("/:id", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const paypointValue = toNumber(req.body?.paypointValue);

  // Locked against the EXISTING row's own (date, shift), not the active
  // context — this updates by id, so the row may belong to a session other
  // than the one the caller is currently working.
  const existing = await prisma.paypointRecord.findUnique({
    where: { paypointRecordId: Number(req.params.id) },
  });
  if (!existing) return res.status(404).json({ message: "Record not found." });
  if (await blockIfLocked(res, existing.date, existing.shift)) return;

  const record = await prisma.paypointRecord.update({
    where: { paypointRecordId: existing.paypointRecordId },
    data: { paypointValue },
  });
  await syncDailySummaryFields(record.date, record.shift, { paypointValue });
  void evaluateAndNotify(record.date, record.shift);

  res.json({ id: record.paypointRecordId, paypointValue: record.paypointValue, date: record.date });
});
