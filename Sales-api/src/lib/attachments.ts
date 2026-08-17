import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Request } from "express";
import { prisma } from "./prisma.js";
import { hasPermission } from "./permissions.js";

// Every page that can carry photo evidence. `section` values are stored
// verbatim in Attachment.section, so renaming a key orphans existing rows —
// add new keys rather than repurposing old ones. Keep in sync with
// SECTIONS in the frontend's PhotoAttachments component.
//
//   permission  – when set, only an admin holding that module permission may
//                 read or write the section (staff accounts never pass, the
//                 same way ProtectedRoute treats admin-only pages).
//   locksWithDay– true for the daily reconciliation pages: once the day is
//                 committed or signed off, its photos freeze along with its
//                 figures. False for catalogue-style pages whose photos are
//                 not part of a single day's submission.
//   dateScoped  – true when a photo belongs to one particular day and is
//                 listed by that day. False for catalogues (Scratch Cards),
//                 where a photo belongs to a thing rather than a date and
//                 must stay visible no matter which day it was taken; those
//                 are addressed by entityId and still record an upload date.
export const ATTACHMENT_SECTIONS = {
  shopSale: { label: "Shop Sale", locksWithDay: true, dateScoped: true },
  cashBanking: { label: "Cash Banking", locksWithDay: true, dateScoped: true },
  creditCardBanking: { label: "Credit Card Banking", locksWithDay: true, dateScoped: true },
  deductions: { label: "Deductions", locksWithDay: true, dateScoped: true },
  safeDrop: { label: "Safe Drop", locksWithDay: true, dateScoped: true },
  lottery: { label: "Lottery", locksWithDay: true, dateScoped: true },
  paypoint: { label: "Paypoint", locksWithDay: true, dateScoped: true },
  instantLotteryInventory: { label: "Instant Lottery Inventory", locksWithDay: true, dateScoped: true },
  supplierInvoices: { label: "Supplier Invoices", locksWithDay: true, dateScoped: true },
  summary: { label: "Summary", locksWithDay: true, dateScoped: true },
  commit: { label: "Commit", locksWithDay: true, dateScoped: true },
  zReports: { label: "Z Reports", locksWithDay: false, dateScoped: true, permission: "reports" },
  scratchCards: { label: "Scratch Cards", locksWithDay: false, dateScoped: false, permission: "scratchCards" },
} as const satisfies Record<
  string,
  { label: string; locksWithDay: boolean; dateScoped: boolean; permission?: string }
>;

export type AttachmentSection = keyof typeof ATTACHMENT_SECTIONS;

export function isAttachmentSection(value: unknown): value is AttachmentSection {
  return typeof value === "string" && Object.hasOwn(ATTACHMENT_SECTIONS, value);
}

// Per-file and per-request ceilings. The frontend downscales camera captures
// before uploading, so a file anywhere near the cap is either an original
// phone photo picked from the gallery or something that is not a photo.
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 10;

export function uploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? "uploads");
}

// Set to the nginx `internal` location (e.g. "/_protected_uploads") to hand
// the actual byte-pushing to nginx via X-Accel-Redirect once authorisation
// has passed. Unset (local dev, or any non-nginx host) streams from Node.
export function accelRedirectPrefix(): string | null {
  const value = process.env.UPLOAD_ACCEL_REDIRECT?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

interface SniffedType {
  mimeType: string;
  extension: string;
}

// Content sniffing rather than trusting the browser's Content-Type or the
// filename: the extension we put on disk is derived from the bytes alone, so
// a .php or .svg renamed to .jpg cannot survive this check.
export function sniffImageType(buffer: Buffer): SniffedType | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", extension: "png" };
  }

  if (buffer.subarray(0, 4).toString("ascii") === "GIF8") {
    return { mimeType: "image/gif", extension: "gif" };
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }

  // HEIC/HEIF — an ISO-BMFF container, identified by the `ftyp` box at offset
  // 4 plus a still-image brand. iPhones hand these over when a photo is picked
  // from the gallery rather than captured through the browser's camera.
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    const heifBrands = ["heic", "heix", "hevc", "heim", "heis", "hevm", "hevs", "mif1", "msf1"];
    if (heifBrands.includes(brand)) {
      return { mimeType: brand.startsWith("hev") ? "image/heic-sequence" : "image/heic", extension: "heic" };
    }
  }

  return null;
}

// Names are generated here and never derived from client input, so the only
// way a traversal sequence reaches a path join is if the database row itself
// were tampered with. Validated on the way back out regardless.
const STORED_NAME_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

export function buildStoredName(extension: string): string {
  return `${randomUUID()}.${extension}`;
}

export function isSafeStoredName(value: string): boolean {
  return STORED_NAME_PATTERN.test(value);
}

// Photos are laid out as <root>/<section>/<YYYY-MM-DD>/<uuid>.<ext> so a day's
// evidence can be archived or pruned with a single directory operation.
export function relativeStoragePath(section: string, date: Date, storedName: string): string {
  return path.posix.join(section, toDateKey(date), storedName);
}

export function absoluteStoragePath(section: string, date: Date, storedName: string): string {
  const root = uploadRoot();
  const resolved = path.resolve(root, relativeStoragePath(section, date, storedName));
  // Defence in depth: even with a validated stored name, never return a path
  // that escaped the upload root.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Resolved attachment path escaped the upload root");
  }
  return resolved;
}

export async function ensureStorageDir(section: string, date: Date): Promise<string> {
  const dir = path.resolve(uploadRoot(), section, toDateKey(date));
  await mkdir(dir, { recursive: true });
  return dir;
}

// Best-effort: a file already gone from disk must not stop the metadata row
// from being deleted, or the row becomes undeletable.
export async function removeStoredFile(section: string, date: Date, storedName: string): Promise<void> {
  if (!isSafeStoredName(storedName)) return;
  try {
    await unlink(absoluteStoragePath(section, date, storedName));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error("Failed to remove attachment file from disk", { section, storedName, err });
    }
  }
}

export function toDateKey(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function todayKey(): string {
  return toDateKey(new Date());
}

// Accepts the YYYY-MM-DD the frontend sends (it already derives that string
// from the active date the API handed it) and pins it to UTC midnight, which
// is how every other @db.Date column in this schema is written.
export function parseDateKey(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Same predicate the Summary/Commit flow uses to decide a day is closed.
export async function isDateLocked(date: Date): Promise<boolean> {
  const record = await prisma.reconciliationRecord.findUnique({ where: { date } });
  return !!record && (record.isStaffCommitted || record.isAdminReconciled);
}

export interface SectionAccessResult {
  ok: boolean;
  status?: number;
  message?: string;
}

// Read/write access to a section. Sections carrying a `permission` are
// admin-only; the rest are open to any authenticated account.
export function checkSectionAccess(req: Request, section: AttachmentSection): SectionAccessResult {
  if (req.userId == null) {
    return { ok: false, status: 401, message: "User not authenticated" };
  }

  const permission = (ATTACHMENT_SECTIONS[section] as { permission?: string }).permission;
  if (permission && !hasPermission(req, permission)) {
    return { ok: false, status: 403, message: "You do not have permission to access this." };
  }

  return { ok: true };
}

export interface AttachmentDto {
  id: number;
  section: string;
  date: string;
  entityId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  source: string;
  uploadedByUserId: number | null;
  uploadedByName: string | null;
  createdAt: Date;
  url: string;
}

export function toAttachmentDto(row: {
  attachmentId: number;
  section: string;
  date: Date;
  entityId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  source: string;
  uploadedByUserId: number | null;
  uploadedByName: string | null;
  createdAt: Date;
}): AttachmentDto {
  return {
    id: row.attachmentId,
    section: row.section,
    date: toDateKey(row.date),
    entityId: row.entityId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    source: row.source,
    uploadedByUserId: row.uploadedByUserId,
    uploadedByName: row.uploadedByName,
    createdAt: row.createdAt,
    url: `/api/attachments/${row.attachmentId}/file`,
  };
}
