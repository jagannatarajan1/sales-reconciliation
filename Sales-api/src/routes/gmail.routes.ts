import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { Router } from "express";
import * as gmailService from "../services/gmail.service.js";

export const gmailRouter = Router();

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function createSignedState(adminUserId: number): string {
  const secret = process.env.JWT_SECRET ?? "";
  const nonce = randomUUID().replace(/-/g, "");
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${adminUserId}.${nonce}.${timestamp}`;
  return `${payload}.${signPayload(payload, secret)}`;
}

function tryValidateSignedState(state: string): number | null {
  const secret = process.env.JWT_SECRET ?? "";
  const parts = state.split(".");
  if (parts.length !== 4) return null;

  const [adminUserIdPart, noncePart, timestampPart, signaturePart] = parts;
  const payload = `${adminUserIdPart}.${noncePart}.${timestampPart}`;
  const expectedSignature = signPayload(payload, secret);

  const actual = Buffer.from(signaturePart);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  const timestamp = parseInt(timestampPart, 10);
  if (Number.isNaN(timestamp)) return null;

  const age = Math.floor(Date.now() / 1000) - timestamp;
  if (age < 0 || age > 600) return null; // valid for 10 minutes

  const adminUserId = parseInt(adminUserIdPart, 10);
  return Number.isNaN(adminUserId) ? null : adminUserId;
}

gmailRouter.get("/connect", (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }
  if (req.userRole !== "admin") {
    return res.status(403).end();
  }

  // The browser reaches this page via a plain link click (so it can then be
  // sent on to Google's own page), which means it can't carry the app's login
  // token as a header. So instead of redirecting straight to Google here, we
  // hand the link back as JSON to an authenticated fetch call, and the page
  // itself does the actual full-page navigation to Google.
  const state = createSignedState(req.userId);
  res.json({ url: gmailService.buildConsentUrl(state) });
});

gmailRouter.get("/callback", async (req, res) => {
  const frontendBaseUrl = process.env.GMAIL_FRONTEND_BASE_URL ?? "";
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (error) {
    return res.status(400).json({ message: "Gmail connection was cancelled or denied." });
  }
  if (!code || !state) {
    return res.status(400).json({ message: "Missing authorization code or state." });
  }

  const adminUserId = tryValidateSignedState(state);
  if (adminUserId == null) {
    return res.status(400).json({ message: "Invalid or expired connection request. Please try connecting again." });
  }

  const success = await gmailService.handleOAuthCallback(code, adminUserId);
  if (!success) {
    return res.status(400).json({ message: "Failed to connect Gmail account. Please try again." });
  }

  if (frontendBaseUrl) {
    return res.redirect(`${frontendBaseUrl}/admin/dashboard?gmail=connected`);
  }

  res.json({ message: "Gmail account connected successfully." });
});

gmailRouter.get("/status", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }
  if (req.userRole !== "admin") {
    return res.status(403).end();
  }

  res.json(await gmailService.getStatus());
});
