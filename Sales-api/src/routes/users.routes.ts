import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import * as userService from "../services/user.service.js";
import { hashPassword } from "../services/auth.service.js";
import { requirePermission, hasPermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/auditLog.js";

export const usersRouter = Router();

const VALID_ROLES = ["user", "admin"] as const;

// "user" accounts never get admin-module access — their real reconciliation
// access is just being logged in, not permission-gated. Whatever the caller
// sent for permissions is discarded for this role.
function normalizePermissions(role: string, permissions: unknown): string[] {
  if (role === "user") return [];
  return Array.isArray(permissions) ? permissions.filter((p) => typeof p === "string") : [];
}

// Guard rail: never let the last active admin be deleted/disabled/demoted —
// with only "user"/"admin" left, admin is the top role and losing the last
// one would lock the account out of admin access entirely.
// Counts active admins other than the target account itself.
async function otherActiveAdminCount(excludeUserId: number): Promise<number> {
  return prisma.user.count({
    where: { role: "admin", isActive: true, userId: { not: excludeUserId } },
  });
}

usersRouter.get("/", async (req, res) => {
  if (!requirePermission(req, res, "userManagement")) return;

  const pageNumber = parseInt((req.query.pageNumber as string) ?? "1", 10);
  const pageSize = parseInt((req.query.pageSize as string) ?? "10", 10);

  const result = await userService.getAllUsers(pageNumber, pageSize);
  res.json(result);
});

usersRouter.get("/:id", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const id = parseInt(req.params.id, 10);
  if (req.userId !== id && !hasPermission(req, "userManagement")) {
    return res.status(403).end();
  }

  const user = await userService.getUserById(id);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  res.json(user);
});

usersRouter.post("/", async (req, res) => {
  if (!requirePermission(req, res, "userManagement")) return;

  const { email, password, name, role, permissions } = req.body ?? {};

  if (!email?.trim() || !password?.trim() || !name?.trim()) {
    return res.status(400).json({ message: "Email, password, and name are required" });
  }

  const requestedRole = typeof role === "string" ? role : "user";
  if (!VALID_ROLES.includes(requestedRole as (typeof VALID_ROLES)[number])) {
    return res.status(400).json({ message: "Invalid role" });
  }

  const existing = await prisma.user.findUnique({ where: { email: email.trim() } });
  if (existing) {
    return res.status(409).json({ message: "A user with this email already exists" });
  }

  const created = await prisma.user.create({
    data: {
      email: email.trim(),
      passwordHash: await hashPassword(password),
      name: name.trim(),
      role: requestedRole,
      permissions: normalizePermissions(requestedRole, permissions),
      isActive: true,
    },
  });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "user_create",
    entity: "User",
    entityId: created.userId,
    newValue: { email: created.email, name: created.name, role: created.role, permissions: created.permissions },
  });

  res.status(201).json({
    userId: created.userId,
    email: created.email,
    name: created.name,
    role: created.role,
    permissions: created.permissions,
    createdAt: created.createdAt,
    isActive: created.isActive,
  });
});

usersRouter.put("/:id", async (req, res) => {
  if (!requirePermission(req, res, "userManagement")) return;

  const id = parseInt(req.params.id, 10);
  const existing = await prisma.user.findUnique({ where: { userId: id } });
  if (!existing) return res.status(404).json({ message: "User not found" });

  const { email, name, role, permissions } = req.body ?? {};

  const nextRole = typeof role === "string" && role.trim() ? role : existing.role;
  if (!VALID_ROLES.includes(nextRole as (typeof VALID_ROLES)[number])) {
    return res.status(400).json({ message: "Invalid role" });
  }

  // Demotion guard: this user is currently admin and the request would
  // change that — block it if they are the last active admin.
  if (existing.role === "admin" && nextRole !== "admin" && existing.isActive) {
    const others = await otherActiveAdminCount(existing.userId);
    if (others === 0) {
      return res.status(409).json({ message: "Cannot demote the last remaining admin account." });
    }
  }

  if (email && email.trim() && email.trim() !== existing.email) {
    const emailTaken = await prisma.user.findUnique({ where: { email: email.trim() } });
    if (emailTaken) return res.status(409).json({ message: "A user with this email already exists" });
  }

  const nextPermissions = normalizePermissions(nextRole, permissions ?? existing.permissions);

  const updated = await prisma.user.update({
    where: { userId: id },
    data: {
      email: email && email.trim() ? email.trim() : existing.email,
      name: name && name.trim() ? name.trim() : existing.name,
      role: nextRole,
      permissions: nextPermissions,
    },
  });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "user_edit",
    entity: "User",
    entityId: updated.userId,
    previousValue: { email: existing.email, name: existing.name, role: existing.role, permissions: existing.permissions },
    newValue: { email: updated.email, name: updated.name, role: updated.role, permissions: updated.permissions },
  });

  res.json({
    userId: updated.userId,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    permissions: updated.permissions,
    createdAt: updated.createdAt,
    isActive: updated.isActive,
  });
});

usersRouter.put("/:id/disable", async (req, res) => {
  if (!requirePermission(req, res, "userManagement")) return;

  const id = parseInt(req.params.id, 10);
  if (req.userId === id) {
    return res.status(400).json({ message: "You cannot disable your own account." });
  }

  const existing = await prisma.user.findUnique({ where: { userId: id } });
  if (!existing) return res.status(404).json({ message: "User not found" });

  if (existing.role === "admin" && existing.isActive) {
    const others = await otherActiveAdminCount(existing.userId);
    if (others === 0) {
      return res.status(409).json({ message: "Cannot disable the last remaining admin account." });
    }
  }

  const updated = await prisma.user.update({ where: { userId: id }, data: { isActive: false } });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "user_disable",
    entity: "User",
    entityId: updated.userId,
    previousValue: { isActive: existing.isActive },
    newValue: { isActive: updated.isActive },
  });

  res.json({ message: "User disabled successfully" });
});

usersRouter.put("/:id/enable", async (req, res) => {
  if (!requirePermission(req, res, "userManagement")) return;

  const id = parseInt(req.params.id, 10);
  const existing = await prisma.user.findUnique({ where: { userId: id } });
  if (!existing) return res.status(404).json({ message: "User not found" });

  const updated = await prisma.user.update({ where: { userId: id }, data: { isActive: true } });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "user_enable",
    entity: "User",
    entityId: updated.userId,
    previousValue: { isActive: existing.isActive },
    newValue: { isActive: updated.isActive },
  });

  res.json({ message: "User enabled successfully" });
});

// Soft delete only — there is no separate "deleted" flag distinct from
// "disabled" on the User model, and adding one is not worth the migration
// for what is functionally the same end state (the account can no longer log
// in). This reuses isActive: false, same as /disable, but is logged as its
// own audit action so the two are distinguishable in the audit trail.
usersRouter.delete("/:id", async (req, res) => {
  if (!requirePermission(req, res, "userManagement")) return;

  const id = parseInt(req.params.id, 10);
  if (req.userId === id) {
    return res.status(400).json({ message: "You cannot delete your own account." });
  }

  const existing = await prisma.user.findUnique({ where: { userId: id } });
  if (!existing) return res.status(404).json({ message: "User not found" });

  if (existing.role === "admin" && existing.isActive) {
    const others = await otherActiveAdminCount(existing.userId);
    if (others === 0) {
      return res.status(409).json({ message: "Cannot delete the last remaining admin account." });
    }
  }

  await prisma.user.update({ where: { userId: id }, data: { isActive: false } });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "user_delete",
    entity: "User",
    entityId: id,
    previousValue: { email: existing.email, name: existing.name, role: existing.role, isActive: existing.isActive },
  });

  res.json({ message: "User deleted successfully" });
});

usersRouter.put("/:id/reset-password", async (req, res) => {
  if (!requirePermission(req, res, "userManagement")) return;

  const id = parseInt(req.params.id, 10);
  const { newPassword } = req.body ?? {};
  if (!newPassword || String(newPassword).trim().length < 6) {
    return res.status(400).json({ message: "New password must be at least 6 characters." });
  }

  const existing = await prisma.user.findUnique({ where: { userId: id } });
  if (!existing) return res.status(404).json({ message: "User not found" });

  await prisma.user.update({
    where: { userId: id },
    data: { passwordHash: await hashPassword(String(newPassword)) },
  });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "user_reset_password",
    entity: "User",
    entityId: id,
  });

  // No email flow — the admin relays the new password to the user directly.
  res.json({ message: "Password reset successfully" });
});
