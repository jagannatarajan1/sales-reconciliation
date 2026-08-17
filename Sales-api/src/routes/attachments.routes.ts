import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "../lib/auditLog.js";
import {
  ATTACHMENT_SECTIONS,
  MAX_FILES_PER_REQUEST,
  MAX_FILE_BYTES,
  absoluteStoragePath,
  accelRedirectPrefix,
  buildStoredName,
  checkSectionAccess,
  ensureStorageDir,
  isAttachmentSection,
  isDateLocked,
  isSafeStoredName,
  parseDateKey,
  relativeStoragePath,
  removeStoredFile,
  sniffImageType,
  toAttachmentDto,
  todayKey,
} from "../lib/attachments.js";

export const attachmentsRouter = Router();

// Files are buffered in memory, not streamed to a temp path, so nothing ever
// touches the filesystem until the bytes have been sniffed and accepted.
// MAX_FILE_BYTES × MAX_FILES_PER_REQUEST bounds the worst case per request.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_REQUEST },
});

// Multer rejects oversized or over-count uploads by throwing, which would
// otherwise surface as an opaque 500 from the shared error handler.
function handleUpload(): ReturnType<typeof upload.array> {
  const middleware = upload.array("photos", MAX_FILES_PER_REQUEST);
  return (req, res, next) => {
    middleware(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? `Each photo must be ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))}MB or smaller.`
            : err.code === "LIMIT_FILE_COUNT"
              ? `You can upload at most ${MAX_FILES_PER_REQUEST} photos at a time.`
              : "Upload rejected.";
        return res.status(400).json({ message });
      }
      if (err) return next(err);
      next();
    });
  };
}

// The section catalogue, so the frontend never hard-codes a list the backend
// would reject.
attachmentsRouter.get("/sections", (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  res.json(
    Object.entries(ATTACHMENT_SECTIONS).map(([key, config]) => ({
      key,
      label: config.label,
      locksWithDay: config.locksWithDay,
    })),
  );
});

// GET /api/attachments?section=cashBanking&date=2026-08-17[&entityId=42]
attachmentsRouter.get("/", async (req, res) => {
  const section = req.query.section;
  if (!isAttachmentSection(section)) {
    return res.status(400).json({ message: "Unknown attachment section." });
  }

  const access = checkSectionAccess(req, section);
  if (!access.ok) return res.status(access.status!).json({ message: access.message });

  const dateScoped = ATTACHMENT_SECTIONS[section].dateScoped;
  const date = parseDateKey(req.query.date);
  if (dateScoped && !date) {
    return res.status(400).json({ message: "A valid date (YYYY-MM-DD) is required." });
  }

  const entityId = typeof req.query.entityId === "string" && req.query.entityId ? req.query.entityId : undefined;

  const rows = await prisma.attachment.findMany({
    // A catalogue section is addressed by entityId alone — its photos must
    // stay visible regardless of the day they happened to be taken.
    where: {
      section,
      ...(dateScoped && date ? { date } : {}),
      ...(entityId ? { entityId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  res.json(rows.map(toAttachmentDto));
});

// POST /api/attachments  (multipart/form-data)
//   fields: section, date, entityId?, source?   files: photos[]
attachmentsRouter.post("/", handleUpload(), async (req, res) => {
  const section = req.body?.section;
  if (!isAttachmentSection(section)) {
    return res.status(400).json({ message: "Unknown attachment section." });
  }

  const access = checkSectionAccess(req, section);
  if (!access.ok) return res.status(access.status!).json({ message: access.message });

  // Catalogue sections still stamp an upload date (it is what the on-disk
  // layout is keyed by), it just defaults to today rather than being required.
  const parsedDate = parseDateKey(req.body?.date);
  const date = parsedDate ?? (ATTACHMENT_SECTIONS[section].dateScoped ? null : parseDateKey(todayKey()));
  if (!date) return res.status(400).json({ message: "A valid date (YYYY-MM-DD) is required." });

  if (ATTACHMENT_SECTIONS[section].locksWithDay && (await isDateLocked(date))) {
    return res.status(409).json({ message: "This date has been committed and can no longer be edited." });
  }

  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length === 0) return res.status(400).json({ message: "No photo was supplied." });

  const entityId = typeof req.body?.entityId === "string" && req.body.entityId ? req.body.entityId : null;
  const source = req.body?.source === "camera" ? "camera" : "file";

  // Sniff everything before writing anything, so one bad file in a batch
  // fails the whole request rather than leaving half of it on disk.
  const accepted: Array<{ buffer: Buffer; fileName: string; mimeType: string; storedName: string }> = [];
  for (const file of files) {
    const sniffed = sniffImageType(file.buffer);
    if (!sniffed) {
      return res
        .status(400)
        .json({ message: `"${file.originalname}" is not a supported image (JPEG, PNG, WebP, GIF or HEIC).` });
    }
    accepted.push({
      buffer: file.buffer,
      // Kept for display only — never used to build a path.
      fileName: file.originalname?.slice(0, 200) || `photo.${sniffed.extension}`,
      mimeType: sniffed.mimeType,
      storedName: buildStoredName(sniffed.extension),
    });
  }

  await ensureStorageDir(section, date);

  const written: string[] = [];
  try {
    for (const item of accepted) {
      await writeFile(absoluteStoragePath(section, date, item.storedName), item.buffer);
      written.push(item.storedName);
    }
  } catch (err) {
    // Roll the partial write back so no orphaned bytes are left behind.
    await Promise.all(written.map((storedName) => removeStoredFile(section, date, storedName)));
    throw err;
  }

  let created;
  try {
    created = await prisma.$transaction(
      accepted.map((item) =>
        prisma.attachment.create({
          data: {
            section,
            date,
            entityId,
            fileName: item.fileName,
            storedName: item.storedName,
            mimeType: item.mimeType,
            sizeBytes: item.buffer.length,
            source,
            uploadedByUserId: req.userId ?? null,
            uploadedByName: req.userName ?? null,
          },
        }),
      ),
    );
  } catch (err) {
    // Metadata is the source of truth; a file with no row is unreachable, so
    // clean the disk rather than leave it.
    await Promise.all(written.map((storedName) => removeStoredFile(section, date, storedName)));
    throw err;
  }

  await writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "AttachmentUploaded",
    entity: "Attachment",
    entityId: created.map((row) => row.attachmentId).join(","),
    newValue: { section, date: req.body.date, entityId, source, count: created.length },
  });

  res.status(201).json(created.map(toAttachmentDto));
});

attachmentsRouter.get("/:id/file", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid attachment id." });

  const row = await prisma.attachment.findUnique({ where: { attachmentId: id } });
  if (!row) return res.status(404).json({ message: "Attachment not found." });

  if (!isAttachmentSection(row.section)) {
    return res.status(404).json({ message: "Attachment not found." });
  }
  const access = checkSectionAccess(req, row.section);
  if (!access.ok) return res.status(access.status!).json({ message: access.message });

  if (!isSafeStoredName(row.storedName)) {
    console.error("Refusing to serve attachment with an unexpected stored name", row.attachmentId);
    return res.status(404).json({ message: "Attachment not found." });
  }

  res.setHeader("Content-Type", row.mimeType);
  // Photos are immutable once uploaded and reachable only with a valid token,
  // so they cache in the browser but never in a shared proxy.
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("Content-Disposition", `inline; filename="${row.storedName}"`);
  // Belt and braces against a stored file that somehow renders as markup.
  res.setHeader("X-Content-Type-Options", "nosniff");

  const accelPrefix = accelRedirectPrefix();
  if (accelPrefix) {
    // nginx takes over the file I/O from here; Node's only job was the
    // authorisation check above.
    res.setHeader("X-Accel-Redirect", `${accelPrefix}/${relativeStoragePath(row.section, row.date, row.storedName)}`);
    return res.end();
  }

  const absolutePath = absoluteStoragePath(row.section, row.date, row.storedName);
  const stream = createReadStream(absolutePath);
  stream.on("error", (err) => {
    console.error("Failed to read attachment from disk", { attachmentId: row.attachmentId, err });
    if (!res.headersSent) res.status(404).json({ message: "Attachment file is missing." });
    else res.end();
  });
  stream.pipe(res);
});

attachmentsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid attachment id." });

  const row = await prisma.attachment.findUnique({ where: { attachmentId: id } });
  if (!row) return res.status(404).json({ message: "Attachment not found." });

  if (!isAttachmentSection(row.section)) {
    return res.status(404).json({ message: "Attachment not found." });
  }
  const access = checkSectionAccess(req, row.section);
  if (!access.ok) return res.status(access.status!).json({ message: access.message });

  if (ATTACHMENT_SECTIONS[row.section].locksWithDay && (await isDateLocked(row.date))) {
    return res.status(409).json({ message: "This date has been committed and can no longer be edited." });
  }

  await prisma.attachment.delete({ where: { attachmentId: id } });
  await removeStoredFile(row.section, row.date, row.storedName);

  await writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "AttachmentDeleted",
    entity: "Attachment",
    entityId: row.attachmentId,
    previousValue: {
      section: row.section,
      date: row.date,
      entityId: row.entityId,
      fileName: row.fileName,
      uploadedByName: row.uploadedByName,
    },
  });

  res.json({ message: "Photo deleted." });
});
