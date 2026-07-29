import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { dateOnly } from "../lib/activeDate.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/auditLog.js";

export const adminActiveDateRouter = Router();

function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  return requirePermission(req, res, "settings");
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

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "active_date_override_set",
    entity: "ActiveDateOverride",
    entityId: 1,
    newValue: { activeDate: date.toISOString().split("T")[0], setAt },
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

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "active_date_override_cleared",
    entity: "ActiveDateOverride",
    entityId: 1,
  });

  res.json({ message: "Active date override cleared." });
});
