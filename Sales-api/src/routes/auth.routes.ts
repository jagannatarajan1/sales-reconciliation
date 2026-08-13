import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import * as userService from "../services/user.service.js";
import {
  generateJwtToken, generateOtpCode, hashOtpCode, otpHashesMatch,
  generateOtpSessionToken, maskEmail,
} from "../services/auth.service.js";
import { sendOtpEmail } from "../lib/otpEmail.js";
import { LoginRequest, RegisterRequest } from "../types/dto.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/auditLog.js";

export const authRouter = Router();

const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 30;
const GENERIC_OTP_ERROR = "Invalid or expired verification code.";

async function issueOtpChallenge(userId: number, email: string) {
  // Only one pending challenge per admin at a time — starting a fresh login
  // (or resend) invalidates whatever was issued before it.
  await prisma.adminLoginOtp.deleteMany({ where: { userId, consumedAt: null } });

  const code = generateOtpCode();
  const sessionToken = generateOtpSessionToken();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000);

  const delivered = await sendOtpEmail(email, code, OTP_EXPIRY_MINUTES);
  if (!delivered) return null;

  await prisma.adminLoginOtp.create({
    data: { userId, sessionToken, codeHash: hashOtpCode(code), expiresAt },
  });

  return { sessionToken, expiresInSeconds: OTP_EXPIRY_MINUTES * 60 };
}

// There is no public/self-service registration path anymore. Creating a new
// login account is an admin action: the caller must be authenticated and
// hold the "userManagement" permission.
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
    // Same generic message regardless of whether the email exists, the
    // password was wrong, or the account belongs to an admin — none of that
    // is ever distinguishable from a failed attempt.
    return res.status(401).json({ message: error });
  }

  // Regular users authenticate in one step, same as before.
  if (user.role !== "admin") {
    void writeAuditLog({
      userId: user.userId, userName: user.name,
      action: "login_success", entity: "User", entityId: user.userId,
    });
    const token = generateJwtToken(user);
    return res.json({ token, user });
  }

  // Admins never get a session token from this endpoint — only a challenge.
  // The token is minted exclusively by POST /auth/otp/verify.
  const challenge = await issueOtpChallenge(user.userId, user.email);
  if (!challenge) {
    void writeAuditLog({
      userId: user.userId, userName: user.name,
      action: "admin_otp_send_failed", entity: "User", entityId: user.userId,
    });
    return res.status(503).json({ message: "Unable to send a verification code right now. Please try again shortly." });
  }

  void writeAuditLog({
    userId: user.userId, userName: user.name,
    action: "admin_otp_sent", entity: "User", entityId: user.userId,
  });

  res.json({
    otpRequired: true,
    otpSessionId: challenge.sessionToken,
    maskedEmail: maskEmail(user.email),
    expiresInSeconds: challenge.expiresInSeconds,
  });
});

authRouter.post("/otp/verify", async (req, res) => {
  const { otpSessionId, code } = req.body ?? {};
  if (!otpSessionId || !code) {
    return res.status(400).json({ message: "otpSessionId and code are required." });
  }

  const challenge = await prisma.adminLoginOtp.findUnique({ where: { sessionToken: String(otpSessionId) } });

  // Same generic error for "no such session", "expired", "already used",
  // and "too many attempts" — none of that is worth distinguishing to a
  // caller who doesn't already hold the right code.
  if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
    return res.status(401).json({ message: GENERIC_OTP_ERROR });
  }

  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.adminLoginOtp.update({ where: { adminLoginOtpId: challenge.adminLoginOtpId }, data: { consumedAt: new Date() } });
    return res.status(401).json({ message: "Too many incorrect attempts. Please request a new code." });
  }

  const matches = otpHashesMatch(hashOtpCode(String(code)), challenge.codeHash);
  if (!matches) {
    const attempts = challenge.attempts + 1;
    await prisma.adminLoginOtp.update({ where: { adminLoginOtpId: challenge.adminLoginOtpId }, data: { attempts } });
    const attemptsRemaining = Math.max(OTP_MAX_ATTEMPTS - attempts, 0);
    return res.status(401).json({ message: GENERIC_OTP_ERROR, attemptsRemaining });
  }

  // Single-use: mark consumed before doing anything else, so a retried
  // request (double-click, network retry) can't verify the same code twice.
  await prisma.adminLoginOtp.update({ where: { adminLoginOtpId: challenge.adminLoginOtpId }, data: { consumedAt: new Date() } });

  const user = await userService.getUserById(challenge.userId);
  if (!user || user.role !== "admin") {
    return res.status(401).json({ message: GENERIC_OTP_ERROR });
  }

  void writeAuditLog({
    userId: user.userId, userName: user.name,
    action: "login_success", entity: "User", entityId: user.userId,
    newValue: { otpVerified: true },
  });

  const token = generateJwtToken(user, true);
  res.json({ token, user });
});

authRouter.post("/otp/resend", async (req, res) => {
  const { otpSessionId } = req.body ?? {};
  if (!otpSessionId) {
    return res.status(400).json({ message: "otpSessionId is required." });
  }

  const challenge = await prisma.adminLoginOtp.findUnique({ where: { sessionToken: String(otpSessionId) } });
  if (!challenge || challenge.consumedAt) {
    return res.status(401).json({ message: GENERIC_OTP_ERROR });
  }

  const secondsSinceLastSend = (Date.now() - challenge.lastSentAt.getTime()) / 1000;
  if (secondsSinceLastSend < OTP_RESEND_COOLDOWN_SECONDS) {
    return res.status(429).json({
      message: "Please wait before requesting another code.",
      retryAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLastSend),
    });
  }

  const user = await userService.getUserById(challenge.userId);
  if (!user || user.role !== "admin") {
    return res.status(401).json({ message: GENERIC_OTP_ERROR });
  }

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000);
  const delivered = await sendOtpEmail(user.email, code, OTP_EXPIRY_MINUTES);
  if (!delivered) {
    return res.status(503).json({ message: "Unable to send a verification code right now. Please try again shortly." });
  }

  await prisma.adminLoginOtp.update({
    where: { adminLoginOtpId: challenge.adminLoginOtpId },
    data: { codeHash: hashOtpCode(code), expiresAt, attempts: 0, lastSentAt: new Date() },
  });

  res.json({
    otpRequired: true,
    otpSessionId: challenge.sessionToken,
    maskedEmail: maskEmail(user.email),
    expiresInSeconds: OTP_EXPIRY_MINUTES * 60,
  });
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
