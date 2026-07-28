import { Router } from "express";
import * as userService from "../services/user.service.js";
import { generateJwtToken } from "../services/auth.service.js";
import { LoginRequest, RegisterRequest } from "../types/dto.js";

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const request = req.body as RegisterRequest;

  if (!request.email?.trim() || !request.password?.trim() || !request.name?.trim()) {
    return res.status(400).json({ message: "Email, password, and name are required" });
  }

  const user = await userService.register(request);
  if (!user) {
    return res.status(400).json({ message: "User with this email already exists" });
  }

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
    return res.status(401).json({ message: error });
  }

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
