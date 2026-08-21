import { Readable } from "node:stream";

// How the bytes for one stored object should reach the client, decided by the
// driver rather than the route. The route authorises, then does what it is
// told here — which is what lets a driver change without touching route code.
//
//   accel    – hand off to nginx via X-Accel-Redirect (local disk in prod)
//   stream   – Node reads and pipes it (local disk in dev, no nginx)
//   redirect – 302 to a short-lived signed URL (what S3/R2 would return)
export type Delivery =
  | { kind: "accel"; path: string }
  | { kind: "stream" }
  | { kind: "redirect"; url: string };

export interface StorageDriver {
  readonly name: string;

  // `key` is always driver-relative and server-generated. Drivers must treat
  // it as untrusted anyway and reject anything that escapes their root.
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;

  resolveDelivery(key: string): Delivery;
}

// Thrown when a key resolves outside the driver's root, or is malformed.
// Routes map this to 400/404 — never surface the offending path to a client.
export class InvalidStorageKeyError extends Error {}

// Thrown when the object is addressable but absent (row/file drift, or a
// half-finished upload). Routes map this to 404.
export class StorageObjectNotFoundError extends Error {}
