import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/auditLog.js";

export const staffRouter = Router();

function toStaffDto(staff: { staffId: number; name: string; isActive: boolean }) {
  return { id: staff.staffId, name: staff.name, isActive: staff.isActive };
}

// Readable by any authenticated user — staff on the Summary/Commit pages need
// this to populate their name dropdown, not just admins.
staffRouter.get("/", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const staff = await prisma.staff.findMany({ orderBy: { name: "asc" } });
  res.json(staff.map(toStaffDto));
});

staffRouter.post("/", async (req, res) => {
  if (!requirePermission(req, res, "userManagement")) return;

  const { name } = req.body ?? {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: "Staff name is required." });
  }

  const created = await prisma.staff.create({ data: { name: String(name).trim() } });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "staff_create",
    entity: "Staff",
    entityId: created.staffId,
    newValue: toStaffDto(created),
  });

  res.status(201).json(toStaffDto(created));
});

staffRouter.put("/:id/toggle", async (req, res) => {
  if (!requirePermission(req, res, "userManagement")) return;

  const staff = await prisma.staff.findUnique({ where: { staffId: Number(req.params.id) } });
  if (!staff) return res.status(404).json({ message: "Staff not found." });

  const updated = await prisma.staff.update({
    where: { staffId: staff.staffId },
    data: { isActive: !staff.isActive },
  });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "staff_toggle",
    entity: "Staff",
    entityId: updated.staffId,
    previousValue: toStaffDto(staff),
    newValue: toStaffDto(updated),
  });

  res.json(toStaffDto(updated));
});

staffRouter.delete("/:id", async (req, res) => {
  if (!requirePermission(req, res, "userManagement")) return;

  const existing = await prisma.staff.findUnique({ where: { staffId: Number(req.params.id) } });
  await prisma.staff.delete({ where: { staffId: Number(req.params.id) } }).catch(() => null);

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "staff_delete",
    entity: "Staff",
    entityId: req.params.id,
    previousValue: existing ? toStaffDto(existing) : null,
  });

  res.json({ message: "Staff deleted successfully" });
});
