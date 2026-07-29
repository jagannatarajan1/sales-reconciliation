import { Router } from "express";
import * as userService from "../services/user.service.js";
import { generateJwtToken } from "../services/auth.service.js";
import { LoginRequest, RegisterRequest } from "../types/dto.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/auditLog.js";

export const authRouter = Router();

// There is no public/self-service registration path anymore. Creating a new
// login account is an admin action: the caller must be authenticated and
// hold the "userManagement" permission (superadmin always passes).
authRouter.post("/register", async (req, res) => {
  if (!requirePermission(req, res, "userManagement")) return;

  const request = req.body as RegisterRequest;

  if (!request.email?.trim() || !request.password?.trim() || !request.name?.trim()) {
    return res.status(400).json({ message: "Email, password, and name are required" });
  }

  const user = await userService.register(request);
  if (!user) {
    return res.status(400).json({ message: "User with this email already exists" });
  }

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "user_register",
    entity: "User",
    entityId: user.userId,
    newValue: { email: user.email, name: user.name, role: user.role, permissions: user.permissions },
  });

  const token = generateJwtToken(user);
  res.json({ token, user });
});

authRouter.post("/login", async (req, res) => {
  const request = req.body as LoginRequest;

  if (!request.email?.trim() || !request.password?.trim()) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const { user, error } = await userService.login(request);
  if (!user) {
    void writeAuditLog({
      action: "login_failure",
      entity: "User",
      newValue: { email: request.email },
    });
    return res.status(401).json({ message: error });
  }

  void writeAuditLog({
    userId: user.userId,
    userName: user.name,
    action: "login_success",
    entity: "User",
    entityId: user.userId,
  });

  const token = generateJwtToken(user);
  res.json({ token, user });
});

authRouter.get("/me", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const user = await userService.getCurrentUser(req.userId);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  res.json(user);
});
