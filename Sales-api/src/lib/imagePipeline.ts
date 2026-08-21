import sharp from "sharp";
import type { Metadata } from "sharp";

// Formats we accept, keyed by the sniffed magic bytes. HEIC is listed because
// iPhones produce it by default; sharp only decodes it when libvips was built
// with libheif, so a HEIC upload may still be rejected at the decode step —
// which is the correct outcome, and the message says so.
const MAGIC: Array<{ mimeType: string; test: (b: Buffer) => boolean }> = [
  { mimeType: "image/jpeg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mimeType: "image/png",
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  { mimeType: "image/gif", test: (b) => b.length > 6 && b.subarray(0, 6).toString("latin1").startsWith("GIF8") },
  {
    mimeType: "image/webp",
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString("latin1") === "RIFF" &&
      b.subarray(8, 12).toString("latin1") === "WEBP",
  },
  {
    mimeType: "image/heic",
    test: (b) =>
      b.length > 12 &&
      b.subarray(4, 8).toString("latin1") === "ftyp" &&
      ["heic", "heix", "hevc", "heim", "heis", "hevm", "mif1"].includes(
        b.subarray(8, 12).toString("latin1")
      ),
  },
];

export class InvalidImageError extends Error {}

// The output is always JPEG regardless of what came in. Normalising the
// output format means one code path downstream, and re-encoding is what
// actually sanitises the file: a polyglot (a PHP script with a JPEG header,
// say) cannot survive a decode-to-pixels-and-re-encode round trip.
const OUTPUT_MIME = "image/jpeg";
const OUTPUT_EXTENSION = "jpg";

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  mimeType: string;
  extension: string;
}

function maxEdge(): number {
  const parsed = Number.parseInt(process.env.PHOTO_MAX_EDGE_PX ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1600;
}

function thumbEdge(): number {
  const parsed = Number.parseInt(process.env.PHOTO_THUMB_EDGE_PX ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 320;
}

// Content sniffing only — the client's Content-Type and the filename are both
// attacker-controlled and are never consulted.
export function sniffMimeType(buffer: Buffer): string | null {
  return MAGIC.find((entry) => entry.test(buffer))?.mimeType ?? null;
}

export function allowedMimeTypes(): string[] {
  const raw = process.env.PHOTO_ALLOWED_TYPES?.trim();
  if (!raw) return ["image/jpeg", "image/png", "image/webp", "image/heic"];
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Validates and normalises one uploaded buffer. Throws InvalidImageError for
// anything a client could plausibly cause; the caller maps that to a 400.
export async function processImage(buffer: Buffer): Promise<ProcessedImage> {
  const sniffed = sniffMimeType(buffer);
  if (!sniffed) {
    throw new InvalidImageError("File is not a recognised image format");
  }
  if (!allowedMimeTypes().includes(sniffed)) {
    throw new InvalidImageError(`${sniffed} images are not accepted`);
  }

  // failOn: "none" keeps sharp from rejecting the mildly-truncated JPEGs that
  // phone cameras genuinely produce; a file that cannot be decoded at all
  // still throws below and is rejected.
  const pipeline = sharp(buffer, { failOn: "none" });

  let metadata: Metadata;
  try {
    metadata = await pipeline.metadata();
  } catch {
    throw new InvalidImageError(
      sniffed === "image/heic"
        ? "HEIC images are not supported by this server. Please upload a JPEG or PNG."
        : "File could not be read as an image"
    );
  }

  if (!metadata.width || !metadata.height) {
    throw new InvalidImageError("Image has no readable dimensions");
  }

  // A decompression bomb is small on disk and enormous in memory. Reject on
  // pixel count before doing any real work on it.
  const megapixels = (metadata.width * metadata.height) / 1_000_000;
  if (megapixels > 80) {
    throw new InvalidImageError("Image dimensions are too large to process");
  }

  const limit = maxEdge();

  try {
    // .rotate() with no argument applies the EXIF orientation and then drops
    // it, so the pixels are upright and no EXIF (including GPS) is carried
    // into the output. sharp does not copy metadata unless asked.
    const full = await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({ width: limit, height: limit, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    const thumbSize = thumbEdge();
    const thumb = await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({ width: thumbSize, height: thumbSize, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();

    const out = await sharp(full).metadata();

    return {
      full,
      thumb,
      width: out.width ?? metadata.width,
      height: out.height ?? metadata.height,
      mimeType: OUTPUT_MIME,
      extension: OUTPUT_EXTENSION,
    };
  } catch (err) {
    if (err instanceof InvalidImageError) throw err;
    throw new InvalidImageError("Image could not be processed");
  }
}
