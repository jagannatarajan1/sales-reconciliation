import { Shift } from "@prisma/client";
import { prisma } from "./prisma.js";

// Whether staff may still write entries for a given session.
//
// There are two locks, at different granularities, and they compose:
//
//   Day   — ReconciliationRecord.isStaffCommitted || isAdminReconciled.
//           Set by POST /Summary/commit (Z-Report gated) and by the admin's
//           POST /admin/reconciliation/submit. Freezes the whole day.
//   Shift — ShiftReconciliation.isShiftCommitted. Set by
//           POST /Summary/shift-commit. Freezes one (date, shift) only, and
//           has no Z gate because a shift is validated against its own
//           X-Report, which arrives at the end of that shift.
//
// A shift is writable only while NEITHER lock is on. The day lock is the
// coarser of the two, so committing a day necessarily freezes both its shifts.

export interface LockState {
  dayLocked: boolean;
  shiftLocked: boolean;
  locked: boolean;
  reason: string | null;
}

const DAY_LOCKED_MESSAGE =
  "This day has been committed — its figures can no longer be changed. Ask an admin to make a correction.";
const SHIFT_LOCKED_MESSAGE =
  "This shift has been committed — its figures can no longer be changed. Ask an admin to make a correction.";

export async function isDayLocked(date: Date): Promise<boolean> {
  const record = await prisma.reconciliationRecord.findUnique({
    where: { date },
    select: { isStaffCommitted: true, isAdminReconciled: true },
  });
  return !!record && (record.isStaffCommitted || record.isAdminReconciled);
}

// FULL_DAY can never be shift-locked: it is the legacy bucket used while
// SHIFT_ENTRY_ENABLED is off, and there is no per-shift sign-off for it.
export async function isShiftCommitted(date: Date, shift: Shift): Promise<boolean> {
  if (shift === Shift.FULL_DAY) return false;
  const row = await prisma.shiftReconciliation.findUnique({
    where: { date_shift: { date, shift } },
    select: { isShiftCommitted: true },
  });
  return !!row?.isShiftCommitted;
}

// One round trip per lock, run together — this sits in the hot path of every
// entry write, so it must not become a chain of sequential queries.
export async function getLockState(date: Date, shift: Shift): Promise<LockState> {
  const [dayLocked, shiftLocked] = await Promise.all([
    isDayLocked(date),
    isShiftCommitted(date, shift),
  ]);

  return {
    dayLocked,
    shiftLocked,
    locked: dayLocked || shiftLocked,
    // The day lock is reported in preference to the shift lock: it is the
    // stronger statement, and an admin correction is the only way out of it.
    reason: dayLocked ? DAY_LOCKED_MESSAGE : shiftLocked ? SHIFT_LOCKED_MESSAGE : null,
  };
}

// Guard for write handlers. Returns true when the caller should stop, having
// already sent a 409 — mirroring the `if (!requirePermission(...)) return;`
// shape used throughout the routes.
export async function blockIfLocked(
  res: { status: (code: number) => { json: (body: unknown) => unknown } },
  date: Date,
  shift: Shift
): Promise<boolean> {
  const state = await getLockState(date, shift);
  if (!state.locked) return false;
  res.status(409).json({ message: state.reason, dayLocked: state.dayLocked, shiftLocked: state.shiftLocked });
  return true;
}
