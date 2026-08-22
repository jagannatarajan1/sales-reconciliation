import { Shift, StoreClosure } from "@prisma/client";
import { prisma } from "./prisma.js";
import { dateOnly } from "./activeDate.js";

// Represents "no shift was expected here" — a holiday or other planned store
// closure — for one (date, shift). See the StoreClosure model doc comment in
// schema.prisma for why `shift` is non-nullable (never FULL_DAY) and a
// whole-day closure is always exactly two rows.
//
// `active` is the current-state flag: a row can exist (with full closedBy*/
// reason history) yet no longer be closed, once reopened via clearClosure.
// Every function below treats "closed" as `active === true` specifically —
// never merely "a row exists" — so reopen-then-reclose and close-then-reopen
// both behave correctly without any special-casing by callers.

export interface ClosuresForDate {
  day: StoreClosure | null;
  night: StoreClosure | null;
}

function assertNotFullDay(shift: Shift): void {
  if (shift === Shift.FULL_DAY) {
    throw new Error("Store closures apply only to DAY or NIGHT, never FULL_DAY.");
  }
}

// Same guard shape as entryLock.ts's isShiftCommitted: FULL_DAY can never be
// closed (there is no per-shift concept while SHIFT_ENTRY_ENABLED is off),
// and returns without querying at all rather than throwing — this is read on
// every entry-page load and reconciliation pass, so it must stay cheap and
// silent for the common "not applicable" case.
export async function isShiftClosed(date: Date, shift: Shift): Promise<boolean> {
  if (shift === Shift.FULL_DAY) return false;
  const d = dateOnly(date);
  const row = await prisma.storeClosure.findUnique({
    where: { date_shift: { date: d, shift } },
    select: { active: true },
  });
  return !!row?.active;
}

// Full row (reason, who, when) for one (date, shift) — null both when no row
// has ever existed AND when one exists but is currently inactive (reopened).
// Callers that want the detail for display use this; callers that only need
// the boolean use isShiftClosed above (a lighter, select-only query).
export async function getClosure(date: Date, shift: Shift): Promise<StoreClosure | null> {
  if (shift === Shift.FULL_DAY) return null;
  const d = dateOnly(date);
  const row = await prisma.storeClosure.findUnique({ where: { date_shift: { date: d, shift } } });
  return row?.active ? row : null;
}

export async function getClosuresForDate(date: Date): Promise<ClosuresForDate> {
  const d = dateOnly(date);
  const rows = await prisma.storeClosure.findMany({
    where: { date: d, shift: { in: [Shift.DAY, Shift.NIGHT] } },
  });
  const day = rows.find((r) => r.shift === Shift.DAY) ?? null;
  const night = rows.find((r) => r.shift === Shift.NIGHT) ?? null;
  return { day: day?.active ? day : null, night: night?.active ? night : null };
}

// Batched range query, one round trip — mirrors getStatusCalendar's
// range-query shape so the admin/staff calendars can add closure dots
// without an extra query per date.
export async function getClosuresForRange(from: Date, to: Date): Promise<Map<string, ClosuresForDate>> {
  const fromD = dateOnly(from);
  const toD = dateOnly(to);
  const rows = await prisma.storeClosure.findMany({
    where: { date: { gte: fromD, lte: toD }, shift: { in: [Shift.DAY, Shift.NIGHT] } },
  });

  const map = new Map<string, ClosuresForDate>();
  for (const row of rows) {
    const key = row.date.toISOString().split("T")[0];
    const entry = map.get(key) ?? { day: null, night: null };
    if (row.shift === Shift.DAY) entry.day = row.active ? row : null;
    else if (row.shift === Shift.NIGHT) entry.night = row.active ? row : null;
    map.set(key, entry);
  }
  return map;
}

// Marks (date, shift) closed. Upserts active + reason/closedBy/closedAt, and
// explicitly clears any prior reopened* fields — so a close → reopen →
// re-close cycle reads as a fresh closure, not a stale reopen record sitting
// alongside an active one.
export async function setClosure(
  date: Date,
  shift: Shift,
  input: { reason: string; userId: number; userName: string | null }
): Promise<StoreClosure> {
  assertNotFullDay(shift);
  const d = dateOnly(date);

  return prisma.storeClosure.upsert({
    where: { date_shift: { date: d, shift } },
    create: {
      date: d,
      shift,
      reason: input.reason,
      active: true,
      closedByUserId: input.userId,
      closedByName: input.userName,
      closedAt: new Date(),
    },
    update: {
      reason: input.reason,
      active: true,
      closedByUserId: input.userId,
      closedByName: input.userName,
      closedAt: new Date(),
      reopenedByUserId: null,
      reopenedByName: null,
      reopenedAt: null,
      reopenReason: null,
    },
  });
}

// Reopens (date, shift). A safe no-op (cleared: false, no write) when the
// shift was never closed or has already been reopened — mirrors
// forceUnlockNightShift's `forced` boolean shape, so callers never need to
// special-case "there was nothing to undo".
export async function clearClosure(
  date: Date,
  shift: Shift,
  input: { userId: number; userName: string | null; reason?: string | null }
): Promise<{ cleared: boolean }> {
  if (shift === Shift.FULL_DAY) return { cleared: false };
  const d = dateOnly(date);

  const existing = await prisma.storeClosure.findUnique({ where: { date_shift: { date: d, shift } } });
  if (!existing?.active) {
    return { cleared: false };
  }

  await prisma.storeClosure.update({
    where: { date_shift: { date: d, shift } },
    data: {
      active: false,
      reopenedByUserId: input.userId,
      reopenedByName: input.userName,
      reopenedAt: new Date(),
      reopenReason: input.reason ?? null,
    },
  });

  return { cleared: true };
}
