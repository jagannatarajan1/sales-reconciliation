import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveDate } from "../lib/activeDate.js";

export const lotteryInstantRouter = Router();

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

async function assertNotCommitted(res: import("express").Response, date: Date): Promise<boolean> {
  const summary = await prisma.dailySummary.findUnique({ where: { date } });
  if (summary?.isCommitted) {
    res.status(409).json({ message: "Today has already been committed and can no longer be edited." });
    return false;
  }
  return true;
}

lotteryInstantRouter.get("/today", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = await getActiveDate();
  const cards = await prisma.scratchCard.findMany({ where: { isActive: true }, orderBy: { scratchCardId: "asc" } });

  const result = [];
  for (const card of cards) {
    const entry = await prisma.instantLotteryInventoryEntry.findUnique({
      where: { scratchCardId_date: { scratchCardId: card.scratchCardId, date } },
    });

    if (entry) {
      result.push({
        id: entry.inventoryId,
        lotteryId: card.scratchCardId,
        scratchCardNo: card.scratchCardNo,
        price: card.price,
        openNo: entry.openNo,
        closeNo: entry.closeNo,
        totalSold: entry.totalSold,
        sales: entry.sales,
      });
      continue;
    }

    let openNo = card.forcedOpenNo ?? 0;
    if (card.forcedOpenNo == null) {
      const previous = await prisma.instantLotteryInventoryEntry.findFirst({
        where: { scratchCardId: card.scratchCardId, date: { lt: date } },
        orderBy: { date: "desc" },
      });
      if (previous) openNo = previous.closeNo;
    }

    result.push({
      id: 0,
      lotteryId: card.scratchCardId,
      scratchCardNo: card.scratchCardNo,
      price: card.price,
      openNo,
      closeNo: 0,
      totalSold: 0,
      sales: 0,
    });
  }

  res.json(result);
});

lotteryInstantRouter.post("/", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = await getActiveDate();
  if (!(await assertNotCommitted(res, date))) return;

  const scratchCardId = toInt(req.body?.lotteryId);
  const openNo = toInt(req.body?.openNo);
  const closeNo = toInt(req.body?.closeNo);

  const card = await prisma.scratchCard.findUnique({ where: { scratchCardId } });
  if (!card) return res.status(404).json({ message: "Scratch card not found." });

  const totalSold = Math.abs(closeNo - openNo);
  const sales = totalSold * Number(card.price);

  const entry = await prisma.instantLotteryInventoryEntry.upsert({
    where: { scratchCardId_date: { scratchCardId, date } },
    create: { scratchCardId, date, openNo, closeNo, totalSold, sales },
    update: { openNo, closeNo, totalSold, sales },
  });

  if (card.forcedOpenNo != null) {
    await prisma.scratchCard.update({ where: { scratchCardId }, data: { forcedOpenNo: null } });
  }

  res.json(entry);
});

lotteryInstantRouter.delete("/today/:lotteryId", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = await getActiveDate();
  if (!(await assertNotCommitted(res, date))) return;

  const scratchCardId = toInt(req.params.lotteryId);
  await prisma.instantLotteryInventoryEntry
    .delete({ where: { scratchCardId_date: { scratchCardId, date } } })
    .catch(() => null);

  res.json({ message: "Inventory cleared" });
});
