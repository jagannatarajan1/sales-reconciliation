import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveDate } from "../lib/activeDate.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/auditLog.js";

export const adminLotteryRouter = Router();

function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  return requirePermission(req, res, "scratchCards");
}

function toCard(card: { scratchCardId: number; scratchCardNo: string; price: unknown; isActive: boolean; forcedOpenNo: number | null; packSize?: number }) {
  return {
    id: card.scratchCardId,
    scratchCardNo: card.scratchCardNo,
    price: card.price,
    isActive: card.isActive,
    forcedOpenNo: card.forcedOpenNo,
    packSize: card.packSize ?? 100,
  };
}

// §10 — ScratchCard has no first-class "stock" concept; this derives
// Opening/Current/Remaining from the existing InstantLotteryInventoryEntry
// open/close numbers (same numbers the staff Instant Lottery Inventory page
// already records) plus the new packSize field, so the admin Scratch Cards
// page can always show stock without inventing any unrelated feature.
async function withStock(card: Awaited<ReturnType<typeof prisma.scratchCard.findUniqueOrThrow>>) {
  const date = await getActiveDate();
  const todayEntry = await prisma.instantLotteryInventoryEntry.findUnique({
    where: { scratchCardId_date: { scratchCardId: card.scratchCardId, date } },
  });

  let opening: number;
  if (card.forcedOpenNo != null) {
    opening = card.forcedOpenNo;
  } else if (todayEntry) {
    opening = todayEntry.openNo;
  } else {
    const previous = await prisma.instantLotteryInventoryEntry.findFirst({
      where: { scratchCardId: card.scratchCardId, date: { lt: date } },
      orderBy: { date: "desc" },
    });
    opening = previous?.closeNo ?? 0;
  }

  const current = todayEntry ? todayEntry.closeNo : opening;
  const sold = Math.max(current - opening, 0);
  const remaining = Math.max(card.packSize - sold, 0);

  return { ...toCard(card), openingStock: opening, currentStock: current, remainingStock: remaining };
}

adminLotteryRouter.get("/scratch-cards", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const cards = await prisma.scratchCard.findMany({ orderBy: { scratchCardId: "asc" } });
  res.json(await Promise.all(cards.map(withStock)));
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

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "scratch_card_create",
    entity: "ScratchCard",
    entityId: created.scratchCardId,
    newValue: toCard(created),
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

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "scratch_card_toggle",
    entity: "ScratchCard",
    entityId: updated.scratchCardId,
    previousValue: toCard(card),
    newValue: toCard(updated),
  });

  res.json(toCard(updated));
});

adminLotteryRouter.delete("/scratch-cards/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const existing = await prisma.scratchCard.findUnique({ where: { scratchCardId: Number(req.params.id) } });
  await prisma.scratchCard.delete({ where: { scratchCardId: Number(req.params.id) } }).catch(() => null);

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "scratch_card_delete",
    entity: "ScratchCard",
    entityId: req.params.id,
    previousValue: existing ? toCard(existing) : null,
  });

  res.json({ message: "Scratch card deleted successfully" });
});
