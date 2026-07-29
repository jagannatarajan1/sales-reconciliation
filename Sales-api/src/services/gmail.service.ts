import { prisma } from "../lib/prisma.js";
import { GmailStatusDto, ZReportEmailDto } from "../types/dto.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface GoogleProfileResponse {
  emailAddress: string;
}

interface GoogleMessageListResponse {
  messages?: { id: string }[];
}

export function buildConsentUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID ?? "",
    redirect_uri: process.env.GMAIL_REDIRECT_URI ?? "",
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function handleOAuthCallback(code: string, adminUserId: number): Promise<boolean> {
  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GMAIL_CLIENT_ID ?? "",
      client_secret: process.env.GMAIL_CLIENT_SECRET ?? "",
      redirect_uri: process.env.GMAIL_REDIRECT_URI ?? "",
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) return false;

  const tokens = (await tokenResponse.json()) as GoogleTokenResponse;
  if (!tokens.access_token || !tokens.refresh_token) return false;

  const profileResponse = await fetch(`${GMAIL_API_BASE}/profile`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileResponse.ok) return false;

  const profile = (await profileResponse.json()) as GoogleProfileResponse;
  if (!profile.emailAddress) return false;

  await prisma.gmailConnection.updateMany({
    where: { isActive: true },
    data: { isActive: false, updatedAt: new Date() },
  });

  await prisma.gmailConnection.create({
    data: {
      emailAddress: profile.emailAddress,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      connectedByUserId: adminUserId,
      isActive: true,
    },
  });

  return true;
}

async function getActiveConnection() {
  return prisma.gmailConnection.findFirst({
    where: { isActive: true },
    orderBy: { connectedAt: "desc" },
  });
}

export async function getStatus(): Promise<GmailStatusDto> {
  const connection = await getActiveConnection();
  if (!connection) return { isConnected: false };

  return {
    isConnected: true,
    emailAddress: connection.emailAddress,
    connectedAt: connection.connectedAt,
  };
}

export async function getValidAccessToken(): Promise<string | null> {
  const connection = await getActiveConnection();
  if (!connection) return null;

  const bufferMs = 60_000;
  if (
    connection.accessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() > Date.now() + bufferMs
  ) {
    return connection.accessToken;
  }

  const refreshResponse = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID ?? "",
      client_secret: process.env.GMAIL_CLIENT_SECRET ?? "",
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!refreshResponse.ok) return null;

  const refreshed = (await refreshResponse.json()) as GoogleTokenResponse;
  if (!refreshed.access_token) return null;

  await prisma.gmailConnection.update({
    where: { gmailConnectionId: connection.gmailConnectionId },
    data: {
      accessToken: refreshed.access_token,
      accessTokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      updatedAt: new Date(),
    },
  });

  return refreshed.access_token;
}

function formatGmailDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

function extractPlainTextBody(payload?: GmailMessagePart): string | null {
  if (!payload) return null;

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const extracted = extractPlainTextBody(part);
      if (extracted) return extracted;
    }
  }

  return null;
}

export async function findZReportEmail(targetDate: Date): Promise<ZReportEmailDto | null> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return null;

  const senderEmail = process.env.GMAIL_SENDER_EMAIL ?? "";
  const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const nextDay = new Date(startOfDay);
  nextDay.setDate(nextDay.getDate() + 1);

  const dateFilter = `after:${formatGmailDate(startOfDay)} before:${formatGmailDate(nextDay)}`;
  const query = senderEmail ? `from:${senderEmail} ${dateFilter}` : dateFilter;

  const listResponse = await fetch(
    `${GMAIL_API_BASE}/messages?q=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listResponse.ok) return null;

  const listResult = (await listResponse.json()) as GoogleMessageListResponse;
  const firstMessageId = listResult.messages?.[0]?.id;
  if (!firstMessageId) return null;

  const messageResponse = await fetch(`${GMAIL_API_BASE}/messages/${firstMessageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!messageResponse.ok) return null;

  const message = (await messageResponse.json()) as {
    payload?: GmailMessagePart;
    internalDate?: string;
  };

  const body = extractPlainTextBody(message.payload) ?? "";
  const emailDate = message.internalDate ? new Date(parseInt(message.internalDate, 10)) : startOfDay;

  return { date: emailDate, body };
}

function encodeBase64Url(data: string): string {
  return Buffer.from(data, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return false;

  const connection = await getActiveConnection();
  const from = connection?.emailAddress ?? "";

  const message = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join(
    "\r\n"
  );

  const response = await fetch(`${GMAIL_API_BASE}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encodeBase64Url(message) }),
  });

  return response.ok;
}
