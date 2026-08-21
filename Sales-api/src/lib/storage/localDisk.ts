import { createReadStream } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  Delivery,
  InvalidStorageKeyError,
  StorageDriver,
  StorageObjectNotFoundError,
} from "./types.js";

// Keys we are willing to touch: forward-slash separated, alphanumeric plus
// - _ . segments, no "..", no leading slash. The server generates every key,
// so this is a belt-and-braces check against a malformed row rather than the
// primary defence — but a bad row must not become an arbitrary file read.
const KEY_PATTERN = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function uploadRoot(): string {
  return path.resolve(process.env.PHOTO_UPLOAD_DIR ?? "./uploads/session-photos");
}

// Set to the nginx `internal` location (e.g. "/_protected_uploads") to let
// nginx push the bytes once the API has authorised. Unset (dev, or any
// non-nginx host) means Node streams them itself.
function accelPrefix(): string | null {
  const value = process.env.PHOTO_ACCEL_REDIRECT?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

export class LocalDiskStorage implements StorageDriver {
  readonly name = "local";

  // Resolves a key to an absolute path, and proves the result is still inside
  // the upload root. path.resolve collapses "..", so comparing the resolved
  // path against the root catches traversal that the regex somehow let by.
  private absolute(key: string): string {
    if (!KEY_PATTERN.test(key)) {
      throw new InvalidStorageKeyError("Malformed storage key");
    }

    const root = uploadRoot();
    const resolved = path.resolve(root, key);

    // The separator suffix matters: "/uploads-other" must not pass a
    // startsWith check against root "/uploads".
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new InvalidStorageKeyError("Storage key escapes the upload root");
    }
    return resolved;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const absolute = this.absolute(key);
    await mkdir(path.dirname(absolute), { recursive: true });
    // 0o640: the service account writes, its group (nginx) reads, nobody else.
    await writeFile(absolute, body, { mode: 0o640 });
  }

  async getStream(key: string): Promise<Readable> {
    const absolute = this.absolute(key);
    if (!(await this.exists(key))) {
      throw new StorageObjectNotFoundError("Stored object is missing");
    }
    return createReadStream(absolute);
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.absolute(key));
    } catch (err) {
      // Already gone is the desired end state, not a failure. Anything else
      // (EACCES, EISDIR) is real and must surface.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.absolute(key));
      return true;
    } catch {
      return false;
    }
  }

  resolveDelivery(key: string): Delivery {
    // Validate before handing a path to nginx — X-Accel-Redirect is followed
    // blindly by nginx, so an unchecked key here would be a file-read primitive.
    this.absolute(key);
    const prefix = accelPrefix();
    return prefix ? { kind: "accel", path: `${prefix}/${key}` } : { kind: "stream" };
  }
}
