import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveContext } from "../lib/activeDate.js";
import { previousShiftEntry } from "../lib/dailyTotals.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/auditLog.js";

export const adminLotteryRouter = Router();

function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  return requirePermission(req, res, "scratchCards");
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

// Opening/current value model (revised — no more stock/pack-size concept).
// Opening Value auto-defaults to the previous day's Current Value, the same
// carry-over shape used for the cash Safe Drop's lastSafe field: if there's
// no value recorded yet for today, fall back to the prior day's close. An
// admin can still override today's opening value via forcedOpenNo (the "Set
// Opening Value" action), which — same as before — takes priority over the
// carry-over default. Current Value is whatever staff has entered today via
// the Instant Lottery Inventory close number; until they do, it mirrors the
// opening value.
async function withValues(card: Awaited<ReturnType<typeof prisma.scratchCard.findUniqueOrThrow>>) {
  const { date, shift } = await getActiveContext();
  const todayEntry = await prisma.instantLotteryInventoryEntry.findUnique({
    where: { scratchCardId_date_shift: { scratchCardId: card.scratchCardId, date, shift } },
  });

  let openingValue: number;
  if (card.forcedOpenNo != null) {
    openingValue = card.forcedOpenNo;
  } else if (todayEntry) {
    openingValue = todayEntry.openNo;
  } else {
    const previous = await previousShiftEntry(card.scratchCardId, date, shift);
    openingValue = previous?.closeNo ?? 0;
  }

  const currentValue = todayEntry ? todayEntry.closeNo : openingValue;

  return { ...toCard(card), openingValue, currentValue };
}

adminLotteryRouter.get("/scratch-cards", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const cards = await prisma.scratchCard.findMany({ orderBy: { scratchCardId: "asc" } });
  res.json(await Promise.all(cards.map(withValues)));
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
