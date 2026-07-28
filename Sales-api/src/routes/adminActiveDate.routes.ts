import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { dateOnly } from "../lib/activeDate.js";

export const adminActiveDateRouter = Router();

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

adminActiveDateRouter.get("/", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const override = await prisma.activeDateOverride.findUnique({ where: { id: 1 } });
  res.json({
    hasOverride: !!override?.activeDate,
    activeDate: override?.activeDate ?? null,
    setAt: override?.setAt ?? null,
  });
});

adminActiveDateRouter.post("/", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const { activeDate } = req.body ?? {};
  if (!activeDate) return res.status(400).json({ message: "activeDate is required." });

  const date = dateOnly(activeDate);
  const setAt = new Date();

  await prisma.activeDateOverride.upsert({
    where: { id: 1 },
    create: { id: 1, activeDate: date, setAt },
    update: { activeDate: date, setAt },
  });

  res.json({ message: `Active date set to ${date.toISOString().split("T")[0]}.`, activeDate: date, setAt });
});

adminActiveDateRouter.delete("/", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  await prisma.activeDateOverride
    .upsert({
      where: { id: 1 },
      create: { id: 1, activeDate: null, setAt: null },
      update: { activeDate: null, setAt: null },
    })
    .catch(() => null);

  res.json({ message: "Active date override cleared." });
});
