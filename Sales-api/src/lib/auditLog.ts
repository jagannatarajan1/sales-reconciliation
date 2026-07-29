import { prisma } from "./prisma.js";

export interface WriteAuditLogInput {
  userId?: number | null;
  userName?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | number | null;
  previousValue?: unknown;
  newValue?: unknown;
}

function stringifyValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Fire-and-forget audit trail writer. This must NEVER throw or reject in a
// way that breaks the caller's real action — any failure here is swallowed
// and (best-effort) logged to the console instead.
export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        userName: input.userName ?? null,
        action: input.action,
        entity: input.entity ?? null,
        entityId: input.entityId != null ? String(input.entityId) : null,
        previousValue: stringifyValue(input.previousValue),
        newValue: stringifyValue(input.newValue),
      },
    });
  } catch (err) {
    console.error("Failed to write audit log entry", err);
  }
}
