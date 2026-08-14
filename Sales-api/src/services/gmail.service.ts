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
  nextPageToken?: string;
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
  headers?: { name: string; value: string }[];
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

function extractHeader(payload: GmailMessagePart | undefined, name: string): string | undefined {
  return payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

export interface TillEmailMessage {
  gmailMessageId: string;
  subject: string;
  receivedAt: Date;
  body: string;
}

// Lists every message from the configured till sender in [after, before),
// full body + Subject header included. Deliberately does NOT filter by
// subject server-side: real inbox evidence showed subjects ranging from the
// documented "X-Report Printed"/"Z-Report Printed" convention down to a bare
// "REPORT" or nothing at all, so Gmail's `subject:` search operator (which
// also tokenises hyphens unpredictably) is not a safe filter. Callers
// classify messages from the parsed body instead (see tillReportParser.ts).
//
// Paginates via nextPageToken — findZReportEmail below used to silently
// take only `messages[0]` (Gmail's newest-first order), which is exactly
// what let a same-day X-Report be mistaken for the Z-Report once the till
// started sending both.
export async function listTillReportEmails(after: Date, before: Date): Promise<TillEmailMessage[]> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return [];

  const senderEmail = process.env.GMAIL_SENDER_EMAIL ?? "";
  const dateFilter = `after:${formatGmailDate(after)} before:${formatGmailDate(before)}`;
  const query = senderEmail ? `from:${senderEmail} ${dateFilter}` : dateFilter;

  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);

    const listResponse = await fetch(`${GMAIL_API_BASE}/messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listResponse.ok) break;

    const listResult = (await listResponse.json()) as GoogleMessageListResponse;
    ids.push(...(listResult.messages ?? []).map((m) => m.id));
    pageToken = listResult.nextPageToken;
  } while (pageToken);

  const messages: TillEmailMessage[] = [];
  for (const id of ids) {
    const messageResponse = await fetch(`${GMAIL_API_BASE}/messages/${id}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!messageResponse.ok) continue;

    const message = (await messageResponse.json()) as {
      payload?: GmailMessagePart;
      internalDate?: string;
    };

    messages.push({
      gmailMessageId: id,
      subject: extractHeader(message.payload, "Subject") ?? "",
      receivedAt: message.internalDate ? new Date(parseInt(message.internalDate, 10)) : new Date(),
      body: extractPlainTextBody(message.payload) ?? "",
    });
  }

  return messages;
}

// Kept as the pre-existing public entry point — every current caller
// (summary.routes.ts, adminReconciliation.routes.ts, reports.routes.ts,
// zReportBills.ts, zReports.routes.ts) keeps working unchanged, but the body
// is now a thin shim over the persisted TillReport table (lib/tillReportIngest.ts)
// instead of a live Gmail call on every invocation. ensureReportsForDate
// ingests on demand (subject to a short throttle) and is a no-op for any
// historical date that already has a Z-Report on file, which is also what
// turns a 30-day range scan from 30 sequential Gmail round-trips into
// effectively zero once backfilled.
//
// This module and tillReportIngest.ts import each other (ingestion needs
// listTillReportEmails to fetch new mail; this needs ensureReportsForDate/
// getZReport to read what's been ingested). That's safe here because neither
// side calls into the other at module-load time — only from inside functions
// invoked later, by which point both modules have finished evaluating.
export async function findZReportEmail(targetDate: Date): Promise<ZReportEmailDto | null> {
  const { ensureReportsForDate, getZReport } = await import("../lib/tillReportIngest.js");

  await ensureReportsForDate(targetDate);
  const report = await getZReport(targetDate);
  return report ? { date: report.emailReceivedAt, body: report.rawBody } : null;
}

function encodeBase64Url(data: string): string {
  return Buffer.from(data, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Email header fields (Subject, From, To, ...) are defined as US-ASCII by
// RFC 5322 — raw UTF-8 bytes dropped in unencoded produce exactly the
// "Ã¢Â€Â”" mojibake this wraps around: a receiver with no MIME-Version /
// encoded-word cue falls back to guessing a single-byte charset (typically
// Windows-1252) and reinterprets each UTF-8 byte as its own character. RFC
// 2047's encoded-word form (`=?UTF-8?B?<base64>?=`) sidesteps the guess
// entirely. Only applied when the value actually has non-ASCII content —
// plain ASCII subjects are left untouched, which is both simpler to read in
// the raw message and avoids caring whether the header line stays under the
// (irrelevant here) 998-octet soft limit.
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

// RFC 2045 base64 body lines must be wrapped (76 chars is the conventional
// limit) — most parsers tolerate unwrapped base64, but some strict MTAs
// don't, and wrapping costs nothing.
function wrapBase64(encoded: string): string {
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? encoded;
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  options: { html?: boolean } = {}
): Promise<boolean> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return false;

  const connection = await getActiveConnection();
  const from = connection?.emailAddress ?? "";

  // The body's own Content-Transfer-Encoding is declared and actually
  // applied here (rather than relying on the outer Gmail API `raw` field's
  // base64url, which only guarantees the bytes survive transport to Gmail
  // intact — it says nothing about how the RFC 2822 message itself, once
  // reconstituted, declares its payload to downstream mail clients).
  // Without an explicit Content-Transfer-Encoding, RFC 2045 defaults to
  // 7bit, i.e. receivers are entitled to assume — and "fix" — any 8-bit
  // byte they find. Declaring base64 and actually base64-encoding the body
  // removes that ambiguity regardless of what the receiving client does.
  const contentType = options.html ? "text/html" : "text/plain";
  const encodedBody = wrapBase64(Buffer.from(body, "utf-8").toString("base64"));

  const headers = [
    "MIME-Version: 1.0",
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Content-Type: ${contentType}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
  ];

  const message = [...headers, "", encodedBody].join("\r\n");

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
