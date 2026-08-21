import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/auditLog.js";
import { getStorage } from "../lib/storage/index.js";
import { deliverPhoto } from "./sessionPhotos.routes.js";
import {
  PHOTO_SECTIONS,
  SESSION_PHOTO_SELECT,
  isPhotoSection,
  parseDateKey,
  parseShift,
  toSessionPhotoDto,
} from "../lib/sessionPhotos.js";

export const adminSessionPhotosRouter = Router();

const BASE_PATH = "/api/admin/session-photos";
const MAX_PAGE_SIZE = 100;

// Builds the shared filter. Every admin query goes through this so a filter
// added here cannot be forgotten on one of the endpoints.
function buildWhere(req: Request): Prisma.SessionPhotoWhereInput | { error: string } {
  const where: Prisma.SessionPhotoWhereInput = { status: "ready" };

  if (typeof req.query.section === "string" && req.query.section) {
    if (!isPhotoSection(req.query.section)) return { error: "Unknown photo section" };
    where.section = req.query.section;
  }

  if (typeof req.query.userId === "string" && req.query.userId) {
    const userId = Number.parseInt(req.query.userId, 10);
    if (!Number.isFinite(userId)) return { error: "Invalid userId" };
    where.uploadedByUserId = userId;
  }

  if (typeof req.query.shift === "string" && req.query.shift) {
    const shift = parseShift(req.query.shift);
    if (!shift) return { error: "Invalid shift" };
    where.shift = shift;
  }

  const from = req.query.fromDate ? parseDateKey(req.query.fromDate) : null;
  const to = req.query.toDate ? parseDateKey(req.query.toDate) : null;

  if (req.query.fromDate && !from) return { error: "Invalid fromDate" };
  if (req.query.toDate && !to) return { error: "Invalid toDate" };
  if (from && to && from > to) return { error: "fromDate cannot be later than toDate" };

  if (from || to) {
    where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }

  return where;
}

// Section catalogue for the admin filter dropdown.
adminSessionPhotosRouter.get("/sections", (req: Request, res: Response) => {
  if (!requirePermission(req, res, "sessionPhotos")) return;

  res.json({
    sections: Object.entries(PHOTO_SECTIONS).map(([key, cfg]) => ({ key, label: cfg.label })),
  });
});

// Distinct uploaders, so the filter can offer real names rather than ids.
adminSessionPhotosRouter.get("/uploaders", async (req: Request, res: Response) => {
  if (!requirePermission(req, res, "sessionPhotos")) return;

  const rows = await prisma.sessionPhoto.groupBy({
    by: ["uploadedByUserId", "uploadedByName"],
    where: { status: "ready" },
    _count: { _all: true },
  });

  res.json({
    uploaders: rows
      .map((row) => ({
        userId: row.uploadedByUserId,
        name: row.uploadedByName ?? `User ${row.uploadedByUserId}`,
        photoCount: row._count._all,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
});

// Sessions (date + shift) with photo counts — the browse index. Grouping in
// SQL keeps this cheap no matter how many photos exist.
adminSessionPhotosRouter.get("/sessions", async (req: Request, res: Response) => {
  if (!requirePermission(req, res, "sessionPhotos")) return;

  const where = buildWhere(req);
  if ("error" in where) return res.status(400).json({ message: where.error });

  const groups = await prisma.sessionPhoto.groupBy({
    by: ["date", "shift"],
    where,
    _count: { _all: true },
    orderBy: [{ date: "desc" }, { shift: "asc" }],
  });

  res.json({
    sessions: groups.map((group) => ({
      date: group.date.toISOString().split("T")[0],
      shift: group.shift,
      photoCount: group._count._all,
    })),
  });
});

// Paginated photo list. Returns thumbnail URLs alongside full ones so the
// grid never has to request a full-resolution image.
adminSessionPhotosRouter.get("/", async (req: Request, res: Response) => {
  if (!requirePermission(req, res, "sessionPhotos")) return;

  const where = buildWhere(req);
  if ("error" in where) return res.status(400).json({ message: where.error });

  const page = Math.max(1, Number.parseInt((req.query.page as string) ?? "1", 10) || 1);
  const requested = Number.parseInt((req.query.pageSize as string) ?? "24", 10) || 24;
  const pageSize = Math.min(Math.max(1, requested), MAX_PAGE_SIZE);

  const [total, rows] = await prisma.$transaction([
    prisma.sessionPhoto.count({ where }),
    prisma.sessionPhoto.findMany({
      where,
      select: SESSION_PHOTO_SELECT,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({
    items: rows.map((row) => toSessionPhotoDto(row, BASE_PATH)),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

adminSessionPhotosRouter.get("/:id/file", async (req: Request, res: Response) => {
  if (!requirePermission(req, res, "sessionPhotos")) return;

  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid photo id" });

  const row = await prisma.sessionPhoto.findUnique({ where: { sessionPhotoId: id } });
  if (!row) return res.status(404).json({ message: "Photo not found" });

  const wantsThumb = req.query.size === "thumb";
  const key = wantsThumb && row.thumbnailKey ? row.thumbnailKey : row.storageKey;
  await deliverPhoto(res, key, wantsThumb ? "image/jpeg" : row.mimeType, row.originalFilename);
});

// Admins may delete regardless of the day lock — the lock exists to stop
// staff altering committed evidence, not to stop an authorised admin
// removing something that should not have been uploaded. Always audited.
adminSessionPhotosRouter.delete("/:id", async (req: Request, res: Response) => {
  if (!requirePermission(req, res, "sessionPhotos")) return;

  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid photo id" });

  const row = await prisma.sessionPhoto.findUnique({ where: { sessionPhotoId: id } });
  if (!row) return res.status(404).json({ message: "Photo not found" });

  await prisma.sessionPhoto.delete({ where: { sessionPhotoId: id } });

  const storage = getStorage();
  await storage.delete(row.storageKey).catch(() => undefined);
  if (row.thumbnailKey) await storage.delete(row.thumbnailKey).catch(() => undefined);

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "admin_session_photo_delete",
    entity: "SessionPhoto",
    entityId: id,
    previousValue: {
      section: row.section,
      date: row.date.toISOString().split("T")[0],
      shift: row.shift,
      uploadedByUserId: row.uploadedByUserId,
      uploadedByName: row.uploadedByName,
    },
  });

  res.json({ message: "Photo deleted" });
});
