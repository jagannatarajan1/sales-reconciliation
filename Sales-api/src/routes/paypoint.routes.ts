import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveDate } from "../lib/activeDate.js";
import { syncDailySummaryFields } from "../lib/dailySummarySync.js";

export const paypointRouter = Router();

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

paypointRouter.get("/", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = await getActiveDate();
  const record = await prisma.paypointRecord.findUnique({ where: { date } });
  if (!record) return res.status(404).json({ message: "No paypoint record found for today." });

  res.json({ id: record.paypointRecordId, paypointValue: record.paypointValue, date: record.date });
});

paypointRouter.post("/", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = await getActiveDate();
  const paypointValue = toNumber(req.body?.paypointValue);
  const record = await prisma.paypointRecord.upsert({
    where: { date },
    create: { date, paypointValue },
    update: { paypointValue },
  });
  await syncDailySummaryFields(date, { paypointValue });

  res.json({ id: record.paypointRecordId, paypointValue: record.paypointValue, date: record.date });
});

paypointRouter.put("/:id", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const paypointValue = toNumber(req.body?.paypointValue);
  const record = await prisma.paypointRecord.update({
    where: { paypointRecordId: Number(req.params.id) },
    data: { paypointValue },
  });
  await syncDailySummaryFields(record.date, { paypointValue });

  res.json({ id: record.paypointRecordId, paypointValue: record.paypointValue, date: record.date });
});
