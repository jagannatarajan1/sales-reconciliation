import { LocalDiskStorage } from "./localDisk.js";
import { StorageDriver } from "./types.js";

export * from "./types.js";
export { uploadRoot } from "./localDisk.js";

let cached: StorageDriver | null = null;

// Only the local driver ships today. The switch exists so adding S3/R2/MinIO
// is a new file plus a case here — no route, DB or UI change, because
// everything upstream only ever sees a driver-relative key.
export function getStorage(): StorageDriver {
  if (cached) return cached;

  const driver = (process.env.PHOTO_STORAGE_DRIVER ?? "local").trim().toLowerCase();

  switch (driver) {
    case "local":
      cached = new LocalDiskStorage();
      return cached;
    default:
      throw new Error(
        `Unknown PHOTO_STORAGE_DRIVER "${driver}". Supported drivers: local`
      );
  }
}
