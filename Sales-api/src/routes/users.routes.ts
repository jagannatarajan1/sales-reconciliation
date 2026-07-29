import { Router } from "express";
import * as userService from "../services/user.service.js";
import { requirePermission, hasPermission } from "../lib/permissions.js";

export const usersRouter = Router();

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
