import { randomUUID } from "node:crypto";
import path from "node:path";
import { Request } from "express";
import { Shift } from "@prisma/client";
import { prisma } from "./prisma.js";
import { hasPermission } from "./permissions.js";
import { getActiveContext } from "./activeDate.js";
import { getLockState } from "./entryLock.js";

// Every page that can carry photo evidence. Values are stored verbatim in
// SessionPhoto.section, so renaming a key orphans existing rows — add new
// keys rather than repurposing old ones. Keep in sync with the frontend's
// src/constants/photoSections.js.
//
//   permission   – when set, only an admin holding that module permission may
//                  read or write the section. Staff never pass (permissions.ts
//                  only ever grants to role === "admin").
//   locksWithDay – true for the daily reconciliation pages: once the day is
//                  committed or signed off, its photos freeze with its figures.
//   dateScoped   – true when a photo belongs to one particular session and is
//                  listed by it. False for catalogues (Scratch Cards), where a
//                  photo belongs to a thing and must stay visible regardless
//                  of which session it was taken in.
export const PHOTO_SECTIONS = {
  shopSale: { label: "Shop Sale", locksWithDay: true, dateScoped: true },
  cashBanking: { label: "Cash Banking", locksWithDay: true, dateScoped: true },
  creditCardBanking: { label: "Credit Card Banking", locksWithDay: true, dateScoped: true },
  deductions: { label: "Deductions", locksWithDay: true, dateScoped: true },
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

export type PhotoSection = keyof typeof PHOTO_SECTIONS;

export function isPhotoSection(value: unknown): value is PhotoSection {
  return typeof value === "string" && Object.hasOwn(PHOTO_SECTIONS, value);
}

export function sectionConfig(section: PhotoSection) {
  return PHOTO_SECTIONS[section] as {
    label: string;
    locksWithDay: boolean;
    dateScoped: boolean;
    permission?: string;
  };
}

// ── Limits ──────────────────────────────────────────────────────────────────

export function maxFileBytes(): number {
  const mb = Number.parseInt(process.env.MAX_PHOTO_SIZE_MB ?? "", 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 10) * 1024 * 1024;
}

export function maxFilesPerRequest(): number {
  const n = Number.parseInt(process.env.PHOTO_MAX_FILES_PER_REQUEST ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

// ── Session identity ────────────────────────────────────────────────────────

export function toDateKey(date: Date): string {
  return date.toISOString().split("T")[0];
}

// Accepts the YYYY-MM-DD the frontend sends and pins it to UTC midnight, the
// way every other @db.Date column in this schema is written.
export function parseDateKey(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseShift(value: unknown): Shift | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return upper in Shift ? (upper as Shift) : null;
}

// The session a staff upload belongs to. Deliberately ignores anything the
// client sent: the browser cannot nominate which (date, shift) it is writing
// to, exactly as the nine entry pages cannot. Same source of truth those
// pages already use.
export async function resolveWriteSession(): Promise<{ date: Date; shift: Shift }> {
  const { date, shift } = await getActiveContext();
  return { date, shift };
}

// ── Storage keys ────────────────────────────────────────────────────────────

// <section>/<YYYY-MM-DD>/<SHIFT>/<uuid>.<ext> — one session's evidence sits in
// one directory, so it can be archived or pruned as a unit.
export function buildStorageKey(
  section: string,
  date: Date,
  shift: Shift,
  extension: string
): { key: string; thumbKey: string } {
  const id = randomUUID();
  const dir = path.posix.join(section, toDateKey(date), shift);
  return {
    key: path.posix.join(dir, `${id}.${extension}`),
    thumbKey: path.posix.join(dir, `${id}_thumb.jpg`),
  };
}

// ── Locking ─────────────────────────────────────────────────────────────────

// Photos freeze exactly when their session's figures do, so this delegates to
// the shared lock rather than keeping a second copy of the predicate.
// Day-scoped sections pass the photo's own shift, so a photo attached to a
// committed morning shift freezes even while the night shift is still open.
export async function isDateLocked(date: Date, shift: Shift = Shift.FULL_DAY): Promise<boolean> {
  const { locked } = await getLockState(date, shift);
  return locked;
}

// ── Access control ──────────────────────────────────────────────────────────

export interface SectionAccessResult {
  ok: boolean;
  status?: number;
  message?: string;
}

// Read/write access to a section. Sections carrying a `permission` are
// admin-only; the rest are open to any authenticated account, because the
// daily entry pages are a shared workspace — staff working the same session
// must see each other's evidence or a handover loses it. Cross-session reads
// are prevented by the query always being scoped to a resolved session, not
// by this check.
export function checkSectionAccess(req: Request, section: PhotoSection): SectionAccessResult {
  if (req.userId == null) {
    return { ok: false, status: 401, message: "User not authenticated" };
  }

  const { permission } = sectionConfig(section);
  if (permission && !hasPermission(req, permission)) {
    return { ok: false, status: 403, message: "You do not have permission to access this." };
  }

  return { ok: true };
}

// ── DTO ─────────────────────────────────────────────────────────────────────

export interface SessionPhotoDto {
  id: number;
  section: string;
  sectionLabel: string;
  date: string;
  shift: Shift;
  entityId: string | null;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  source: string;
  status: string;
  uploadedByUserId: number;
  uploadedByName: string | null;
  createdAt: Date;
  // Relative API paths, not storage locations. Nothing derived from
  // storageKey is ever sent to a client.
  url: string;
  thumbnailUrl: string | null;
}

export interface SessionPhotoRow {
  sessionPhotoId: number;
  section: string;
  date: Date;
  shift: Shift;
  entityId: string | null;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  source: string;
  status: string;
  uploadedByUserId: number;
  uploadedByName: string | null;
  thumbnailKey: string | null;
  createdAt: Date;
}

export function toSessionPhotoDto(row: SessionPhotoRow, basePath: string): SessionPhotoDto {
  return {
    id: row.sessionPhotoId,
    section: row.section,
    sectionLabel: isPhotoSection(row.section) ? sectionConfig(row.section).label : row.section,
    date: toDateKey(row.date),
    shift: row.shift,
    entityId: row.entityId,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    width: row.width,
    height: row.height,
    source: row.source,
    status: row.status,
    uploadedByUserId: row.uploadedByUserId,
    uploadedByName: row.uploadedByName,
    createdAt: row.createdAt,
    url: `${basePath}/${row.sessionPhotoId}/file`,
    thumbnailUrl: row.thumbnailKey ? `${basePath}/${row.sessionPhotoId}/file?size=thumb` : null,
  };
}

export const SESSION_PHOTO_SELECT = {
  sessionPhotoId: true,
  section: true,
  date: true,
  shift: true,
  entityId: true,
  originalFilename: true,
  mimeType: true,
  fileSize: true,
  width: true,
  height: true,
  source: true,
  status: true,
  uploadedByUserId: true,
  uploadedByName: true,
  thumbnailKey: true,
  createdAt: true,
} as const;
