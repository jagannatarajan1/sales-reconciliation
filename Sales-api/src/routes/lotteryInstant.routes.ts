import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveDate } from "../lib/activeDate.js";

export const lotteryInstantRouter = Router();

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// The Open No shown/expected for a card+date when no inventory row has been
// saved for that date yet: an admin's explicit "Set Opening" override
// (forcedOpenNo) takes priority, otherwise it carries over from the previous
// day's Close No. Shared by GET /today (what the UI displays) and POST /
// (what a "user" role's submission is compared against, below).
async function computeDefaultOpenNo(
  card: { scratchCardId: number; forcedOpenNo: number | null },
  date: Date
): Promise<number> {
  if (card.forcedOpenNo != null) return card.forcedOpenNo;
  const previous = await prisma.instantLotteryInventoryEntry.findFirst({
    where: { scratchCardId: card.scratchCardId, date: { lt: date } },
    orderBy: { date: "desc" },
  });
  return previous ? previous.closeNo : 0;
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

    const openNo = await computeDefaultOpenNo(card, date);

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
  const scratchCardId = toInt(req.body?.lotteryId);
  const openNo = toInt(req.body?.openNo);
  const closeNo = toInt(req.body?.closeNo);
  const priceProvided = req.body?.price !== undefined && req.body?.price !== null && req.body?.price !== "";
  const submittedPrice = priceProvided ? Number(req.body.price) : null;

  const card = await prisma.scratchCard.findUnique({ where: { scratchCardId } });
  if (!card) return res.status(404).json({ message: "Scratch card not found." });

  const existingEntry = await prisma.instantLotteryInventoryEntry.findUnique({
    where: { scratchCardId_date: { scratchCardId, date } },
  });

  // Role split on this endpoint: an admin may edit Price, Open No and Close
  // No; a "user" may edit Close No only. The frontend already renders Price
  // and Open No read-only for "user", but that's cosmetic, so it is enforced
  // here as well for anyone hitting the endpoint directly.
  //
  // Only reject when the submitted value actually differs from what is
  // currently stored — resubmitting the same value is not a change and must
  // go through, since that is exactly what every normal Close No save does.
  const storedOpenNo = existingEntry ? existingEntry.openNo : await computeDefaultOpenNo(card, date);
  const storedPrice = Number(card.price);
  const isAdmin = req.userRole === "admin";

  if (!isAdmin) {
    const attemptedOpenNoChange = openNo !== storedOpenNo;
    const attemptedPriceChange = priceProvided && submittedPrice !== storedPrice;

    if (attemptedOpenNoChange || attemptedPriceChange) {
      return res.status(403).json({
        message: "Only an admin can change the Instant Lottery Price or Open No. Close No can still be saved.",
      });
    }
  }

  // Admin-only: persist a Price change onto the ScratchCard record. Done
  // before the entry is written so the day's sales figure below is computed
  // from the new price rather than the one it is replacing.
  const effectivePrice =
    isAdmin && submittedPrice != null && Number.isFinite(submittedPrice) ? submittedPrice : storedPrice;

  if (effectivePrice !== storedPrice) {
    await prisma.scratchCard.update({ where: { scratchCardId }, data: { price: effectivePrice } });
  }

  // Non-admins never get to move Open No, so the stored value is what gets
  // written regardless of what the request body carried.
  const effectiveOpenNo = isAdmin ? openNo : storedOpenNo;

  const totalSold = Math.abs(closeNo - effectiveOpenNo);
  const sales = totalSold * effectivePrice;

  const entry = await prisma.instantLotteryInventoryEntry.upsert({
    where: { scratchCardId_date: { scratchCardId, date } },
    create: { scratchCardId, date, openNo: effectiveOpenNo, closeNo, totalSold, sales },
    update: { openNo: effectiveOpenNo, closeNo, totalSold, sales },
  });

  if (card.forcedOpenNo != null) {
    await prisma.scratchCard.update({ where: { scratchCardId }, data: { forcedOpenNo: null } });
  }

  res.json(entry);
});

lotteryInstantRouter.delete("/today/:lotteryId", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = await getActiveDate();
  const scratchCardId = toInt(req.params.lotteryId);
  await prisma.instantLotteryInventoryEntry
    .delete({ where: { scratchCardId_date: { scratchCardId, date } } })
    .catch(() => null);

  res.json({ message: "Inventory cleared" });
});
