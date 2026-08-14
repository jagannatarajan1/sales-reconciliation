import { Router } from "express";
import { Shift } from "@prisma/client";
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
    activeShift: override?.activeShift ?? null,
    setAt: override?.setAt ?? null,
  });
});

adminActiveDateRouter.post("/", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const body = req.body ?? {};
  const { activeDate } = body;
  if (!activeDate) return res.status(400).json({ message: "activeDate is required." });

  const date = dateOnly(activeDate);
  const setAt = new Date();

  // activeShift is optional and tri-state: omit the key entirely to leave
  // whatever shift override is already set untouched (e.g. an admin just
  // moving the date shouldn't silently clear a "force night shift" they set
  // earlier); send null explicitly to clear it back to clock-derived; send
  // "DAY"/"NIGHT" to force it.
  const hasShiftKey = Object.prototype.hasOwnProperty.call(body, "activeShift");
  let shiftValue: Shift | null | undefined;
  if (hasShiftKey) {
    if (body.activeShift === null || body.activeShift === "") {
      shiftValue = null;
    } else if (body.activeShift === Shift.DAY || body.activeShift === Shift.NIGHT) {
      shiftValue = body.activeShift;
    } else {
      return res.status(400).json({ message: "activeShift must be 'DAY', 'NIGHT', or null." });
    }
  }

  await prisma.activeDateOverride.upsert({
    where: { id: 1 },
    create: { id: 1, activeDate: date, activeShift: shiftValue ?? null, setAt },
    update: { activeDate: date, setAt, ...(hasShiftKey ? { activeShift: shiftValue } : {}) },
  });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "active_date_override_set",
    entity: "ActiveDateOverride",
    entityId: 1,
    newValue: { activeDate: date.toISOString().split("T")[0], activeShift: shiftValue, setAt },
  });

  res.json({
    message: `Active date set to ${date.toISOString().split("T")[0]}.`,
    activeDate: date,
    activeShift: shiftValue,
    setAt,
  });
});

adminActiveDateRouter.delete("/", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  await prisma.activeDateOverride
    .upsert({
      where: { id: 1 },
      create: { id: 1, activeDate: null, activeShift: null, setAt: null },
      update: { activeDate: null, activeShift: null, setAt: null },
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
