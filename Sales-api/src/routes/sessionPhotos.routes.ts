import { Router, Request, Response } from "express";
import multer, { MulterError } from "multer";
import { Shift } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "../lib/auditLog.js";
import { getStorage, InvalidStorageKeyError, StorageObjectNotFoundError } from "../lib/storage/index.js";
import { InvalidImageError, processImage } from "../lib/imagePipeline.js";
import {
  PHOTO_SECTIONS,
  SESSION_PHOTO_SELECT,
  buildStorageKey,
  checkSectionAccess,
  isDateLocked,
  isPhotoSection,
  maxFileBytes,
  maxFilesPerRequest,
  resolveWriteSession,
  sectionConfig,
  toSessionPhotoDto,
} from "../lib/sessionPhotos.js";

export const sessionPhotosRouter = Router();

const BASE_PATH = "/api/session-photos";

// memoryStorage on purpose: nothing reaches the filesystem until it has been
// sniffed, decoded and re-encoded. multer's own diskStorage would write the
// raw client bytes first, which is exactly what we refuse to do.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileBytes(), files: maxFilesPerRequest() },
});

// ── Shared helpers ──────────────────────────────────────────────────────────

// Streams or hands off one stored object after the caller has authorised it.
// Kept here so the staff and admin routes cannot drift on delivery semantics.
export async function deliverPhoto(
  res: Response,
  key: string,
  mimeType: string,
  filename: string
): Promise<void> {
  const storage = getStorage();

  try {
    const delivery = storage.resolveDelivery(key);

    // Private: a photo must never be cached by a shared proxy, and the
    // filename is quoted-escaped because it is user-supplied text.
    res.setHeader("Content-Type", mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300, must-revalidate");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${filename.replace(/["\\]/g, "_")}"`
    );

    if (delivery.kind === "accel") {
      // nginx does the disk I/O now that we have authorised the request.
      res.setHeader("X-Accel-Redirect", delivery.path);
      res.end();
      return;
    }

    if (delivery.kind === "redirect") {
      res.redirect(302, delivery.url);
      return;
    }

    const stream = await storage.getStream(key);
    stream.on("error", () => {
      if (!res.headersSent) res.status(404).json({ message: "Photo file is unavailable" });
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    // Never echo the key or a filesystem path back to the client.
    if (err instanceof StorageObjectNotFoundError || err instanceof InvalidStorageKeyError) {
      res.status(404).json({ message: "Photo file is unavailable" });
      return;
    }
    throw err;
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

// Section catalogue, so the frontend need not hardcode labels/lock rules.
sessionPhotosRouter.get("/sections", (req: Request, res: Response) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const sections = Object.entries(PHOTO_SECTIONS).map(([key, cfg]) => ({
    key,
    label: cfg.label,
    dateScoped: cfg.dateScoped,
    locksWithDay: cfg.locksWithDay,
  }));
  res.json({ sections });
});

// The active session, so a page can show which (date, shift) it is filing to.
sessionPhotosRouter.get("/session", async (req: Request, res: Response) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const { date, shift } = await resolveWriteSession();
  res.json({ date: date.toISOString().split("T")[0], shift, isLocked: await isDateLocked(date) });
});

// List photos for the active session (or, for catalogue sections, for one
// entity across all sessions). The client cannot ask for another session.
sessionPhotosRouter.get("/", async (req: Request, res: Response) => {
  const section = req.query.section;
  if (!isPhotoSection(section)) {
    return res.status(400).json({ message: "Unknown photo section" });
  }

  const access = checkSectionAccess(req, section);
  if (!access.ok) return res.status(access.status!).json({ message: access.message });

  const cfg = sectionConfig(section);
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : null;

  if (!cfg.dateScoped && !entityId) {
    return res.status(400).json({ message: "entityId is required for this section" });
  }

  const { date, shift } = await resolveWriteSession();

  const rows = await prisma.sessionPhoto.findMany({
    where: {
      section,
      status: "ready",
      ...(cfg.dateScoped ? { date, shift } : {}),
      ...(entityId ? { entityId } : {}),
    },
    select: SESSION_PHOTO_SELECT,
    orderBy: { createdAt: "asc" },
  });

  res.json({
    date: date.toISOString().split("T")[0],
    shift,
    isLocked: cfg.locksWithDay ? await isDateLocked(date) : false,
    items: rows.map((row) => toSessionPhotoDto(row, BASE_PATH)),
  });
});

sessionPhotosRouter.post("/", upload.array("photos"), async (req: Request, res: Response) => {
  const section = req.body?.section;
  if (!isPhotoSection(section)) {
    return res.status(400).json({ message: "Unknown photo section" });
  }

  const access = checkSectionAccess(req, section);
  if (!access.ok) return res.status(access.status!).json({ message: access.message });

  const cfg = sectionConfig(section);
  const entityId = typeof req.body?.entityId === "string" && req.body.entityId ? req.body.entityId : null;
  const source = req.body?.source === "camera" ? "camera" : "file";

  if (!cfg.dateScoped && !entityId) {
    return res.status(400).json({ message: "entityId is required for this section" });
  }

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    return res.status(400).json({ message: "No photo was received" });
  }

  // Session comes from the server, never the request body.
  const { date, shift } = await resolveWriteSession();

  if (cfg.locksWithDay && (await isDateLocked(date))) {
    return res.status(409).json({
      message: "This day has been committed — its photos can no longer be changed.",
    });
  }

  // Process every file before writing any of them, so a bad third file does
  // not leave the first two on disk.
  const processed: Array<{
    key: string;
    thumbKey: string;
    full: Buffer;
    thumb: Buffer;
    width: number;
    height: number;
    mimeType: string;
    originalFilename: string;
  }> = [];

  for (const file of files) {
    try {
      const image = await processImage(file.buffer);
      const { key, thumbKey } = buildStorageKey(section, date, shift, image.extension);
      processed.push({
        key,
        thumbKey,
        full: image.full,
        thumb: image.thumb,
        width: image.width,
        height: image.height,
        mimeType: image.mimeType,
        // Kept for display only; never used to build a path.
        originalFilename: (file.originalname || "photo").slice(0, 200),
      });
    } catch (err) {
      if (err instanceof InvalidImageError) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }
  }

  const storage = getStorage();
  const written: string[] = [];

  try {
    for (const item of processed) {
      await storage.put(item.key, item.full, item.mimeType);
      written.push(item.key);
      await storage.put(item.thumbKey, item.thumb, "image/jpeg");
      written.push(item.thumbKey);
    }

    const created = await prisma.$transaction(
      processed.map((item) =>
        prisma.sessionPhoto.create({
          data: {
            section,
            date,
            shift,
            entityId,
            uploadedByUserId: req.userId as number,
            uploadedByName: req.userName ?? null,
            originalFilename: item.originalFilename,
            storageKey: item.key,
            thumbnailKey: item.thumbKey,
            mimeType: item.mimeType,
            fileSize: item.full.length,
            width: item.width,
            height: item.height,
            source,
            status: "ready",
          },
          select: SESSION_PHOTO_SELECT,
        })
      )
    );

    void writeAuditLog({
      userId: req.userId,
      userName: req.userName,
      action: "session_photo_upload",
      entity: "SessionPhoto",
      entityId: created.map((row) => row.sessionPhotoId).join(","),
      newValue: {
        section,
        date: date.toISOString().split("T")[0],
        shift,
        entityId,
        count: created.length,
        source,
      },
    });

    res.status(201).json({ items: created.map((row) => toSessionPhotoDto(row, BASE_PATH)) });
  } catch (err) {
    // Roll the blobs back so a failed insert cannot leave orphaned files.
    await Promise.all(written.map((key) => storage.delete(key).catch(() => undefined)));
    throw err;
  }
});

sessionPhotosRouter.get("/:id/file", async (req: Request, res: Response) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid photo id" });

  const row = await prisma.sessionPhoto.findUnique({ where: { sessionPhotoId: id } });
  if (!row) return res.status(404).json({ message: "Photo not found" });

  if (!isPhotoSection(row.section)) {
    return res.status(404).json({ message: "Photo not found" });
  }

  // Section permission is re-checked here, not just at list time — changing
  // the id in the URL must not reach a section the caller cannot read.
  const access = checkSectionAccess(req, row.section);
  if (!access.ok) return res.status(access.status!).json({ message: access.message });

  const cfg = sectionConfig(row.section);

  // Staff may only read the session they are currently working. Admins are
  // served by the admin router, which has its own browse rules.
  if (cfg.dateScoped && req.userRole !== "admin") {
    const { date, shift } = await resolveWriteSession();
    if (row.date.getTime() !== date.getTime() || row.shift !== shift) {
      return res.status(403).json({ message: "You do not have permission to access this." });
    }
  }

  const wantsThumb = req.query.size === "thumb";
  const key = wantsThumb && row.thumbnailKey ? row.thumbnailKey : row.storageKey;
  await deliverPhoto(res, key, wantsThumb ? "image/jpeg" : row.mimeType, row.originalFilename);
});

sessionPhotosRouter.delete("/:id", async (req: Request, res: Response) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid photo id" });

  const row = await prisma.sessionPhoto.findUnique({ where: { sessionPhotoId: id } });
  if (!row) return res.status(404).json({ message: "Photo not found" });

  if (!isPhotoSection(row.section)) return res.status(404).json({ message: "Photo not found" });

  const access = checkSectionAccess(req, row.section);
  if (!access.ok) return res.status(access.status!).json({ message: access.message });

  const cfg = sectionConfig(row.section);

  if (cfg.dateScoped && req.userRole !== "admin") {
    const { date, shift } = await resolveWriteSession();
    if (row.date.getTime() !== date.getTime() || row.shift !== shift) {
      return res.status(403).json({ message: "You do not have permission to access this." });
    }
  }

  if (cfg.locksWithDay && (await isDateLocked(row.date))) {
    return res.status(409).json({
      message: "This day has been committed — its photos can no longer be changed.",
    });
  }

  // Row first: a delete that removes the file but fails on the row would
  // leave an undeletable record pointing at nothing.
  await prisma.sessionPhoto.delete({ where: { sessionPhotoId: id } });

  const storage = getStorage();
  await storage.delete(row.storageKey).catch(() => undefined);
  if (row.thumbnailKey) await storage.delete(row.thumbnailKey).catch(() => undefined);

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "session_photo_delete",
    entity: "SessionPhoto",
    entityId: id,
    previousValue: {
      section: row.section,
      date: row.date.toISOString().split("T")[0],
      shift: row.shift,
      uploadedByUserId: row.uploadedByUserId,
    },
  });

  res.json({ message: "Photo deleted" });
});

// multer rejects oversized/too-many files by throwing, which would otherwise
// reach the central handler as a 500. These are client errors.
sessionPhotosRouter.use((err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
  if (err instanceof MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? `Each photo must be ${Math.round(maxFileBytes() / (1024 * 1024))}MB or smaller.`
        : err.code === "LIMIT_FILE_COUNT"
          ? `You can upload at most ${maxFilesPerRequest()} photos at a time.`
          : "That upload could not be accepted.";
    return res.status(400).json({ message });
  }
  next(err);
});
