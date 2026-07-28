import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const adminLotteryRouter = Router();

function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  if (req.userId == null) {
    res.status(401).json({ message: "User not authenticated" });
    return false;
  }
  if (req.userRole !== "admin") {
    res.status(403).json({ message: "Admin access required." });
    return false;
  }
  return true;
}

function toCard(card: { scratchCardId: number; scratchCardNo: string; price: unknown; isActive: boolean; forcedOpenNo: number | null }) {
  return {
    id: card.scratchCardId,
    scratchCardNo: card.scratchCardNo,
    price: card.price,
    isActive: card.isActive,
    forcedOpenNo: card.forcedOpenNo,
  };
}

adminLotteryRouter.get("/scratch-cards", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const cards = await prisma.scratchCard.findMany({ orderBy: { scratchCardId: "asc" } });
  res.json(cards.map(toCard));
});

adminLotteryRouter.post("/scratch-cards", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const { scratchCardNo, price } = req.body ?? {};
  if (!scratchCardNo || !String(scratchCardNo).trim()) {
    return res.status(400).json({ message: "Scratch card number is required." });
  }

  const created = await prisma.scratchCard.create({
    data: { scratchCardNo: String(scratchCardNo).trim(), price: Number(price) || 0 },
  });
  res.json(toCard(created));
});

adminLotteryRouter.put("/scratch-cards/:id/open-value", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const openValue = Number(req.body?.openValue);
  const updated = await prisma.scratchCard.update({
    where: { scratchCardId: Number(req.params.id) },
    data: { forcedOpenNo: Number.isFinite(openValue) ? Math.trunc(openValue) : 0 },
  });
  res.json(toCard(updated));
});

adminLotteryRouter.put("/scratch-cards/:id/toggle", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const card = await prisma.scratchCard.findUnique({ where: { scratchCardId: Number(req.params.id) } });
  if (!card) return res.status(404).json({ message: "Scratch card not found." });

  const updated = await prisma.scratchCard.update({
    where: { scratchCardId: card.scratchCardId },
    data: { isActive: !card.isActive },
  });
  res.json(toCard(updated));
});

adminLotteryRouter.delete("/scratch-cards/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  await prisma.scratchCard.delete({ where: { scratchCardId: Number(req.params.id) } }).catch(() => null);
  res.json({ message: "Scratch card deleted successfully" });
});
