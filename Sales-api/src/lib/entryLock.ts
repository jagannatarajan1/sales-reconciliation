import { Shift } from "@prisma/client";
import { prisma } from "./prisma.js";
import { isShiftClosed } from "./storeClosure.js";

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

// ── Prior-shift gate (Night waits on Day) ───────────────────────────────────
//
// A SEPARATE concept from the two locks above, which is why it lives here
// rather than folded into getLockState/blockIfLocked. Those ask "has THIS
// shift/day already been submitted, so no more edits" — post-hoc, once
// something is done. This asks "has the PRIOR shift in the DAY→NIGHT
// sequence been submitted YET" — a pre-condition that must be true before
// Night entry may even open. The two compose independently: a shift can be
// simultaneously "not prior-shift-pending" and "locked" (Night, once Day is
// committed and then Night itself gets committed), and the reverse can never
// happen for Night (while waiting on Day, Night has no ShiftReconciliation
// commit of its own yet, so it is never separately locked at the same time).
//
// Only NIGHT is ever gated: DAY has nothing before it in the sequence, and
// FULL_DAY is exempt because the two-shift sequence does not exist while
// SHIFT_ENTRY_ENABLED is off. A missing ShiftReconciliation row for (date,
// DAY) — Day has no entries at all yet — counts as "not committed", i.e.
// still pending, the same as an explicit isShiftCommitted: false. It is
// never treated as an error or as an implicit pass.
//
// A Day marked Closed (storeClosure.ts) is the one other way to satisfy this
// gate: nothing was ever going to be submitted for a closed Day, so Night
// must not wait on it forever. See getPriorShiftGate below for where that
// check lives — deliberately scoped inside the `shift === NIGHT` branch only,
// so it never adds a query for DAY/FULL_DAY callers.

export interface PriorShiftGate {
  waitingOnDayShift: boolean;
  // Whether Day has ANY staff entries on file yet (ShiftReconciliation.
  // hasEntries), surfaced so a waiting message can distinguish "nobody has
  // started Day yet" from "Day is under way but not submitted" without a
  // second round trip.
  dayShiftHasEntries: boolean;
}

const NOT_WAITING: PriorShiftGate = { waitingOnDayShift: false, dayShiftHasEntries: false };

export async function getPriorShiftGate(date: Date, shift: Shift): Promise<PriorShiftGate> {
  if (shift !== Shift.NIGHT) return NOT_WAITING;

  // A Day marked Closed (see storeClosure.ts) counts as satisfied — nothing
  // was ever going to be submitted for it. Queried only inside this NIGHT
  // branch, alongside the existing ShiftReconciliation lookup, so DAY/
  // FULL_DAY keep making zero extra queries (see NOT_WAITING above).
  const [dayRow, dayClosed] = await Promise.all([
    prisma.shiftReconciliation.findUnique({
      where: { date_shift: { date, shift: Shift.DAY } },
      select: { isShiftCommitted: true, hasEntries: true },
    }),
    isShiftClosed(date, Shift.DAY),
  ]);

  return {
    waitingOnDayShift: !dayClosed && !dayRow?.isShiftCommitted,
    dayShiftHasEntries: !!dayRow?.hasEntries,
  };
}

// Boolean-only convenience form for callers (the shift-commit guard below,
// tests) that don't need the extra "has Day got entries" context.
export async function isPriorShiftPending(date: Date, shift: Shift): Promise<boolean> {
  return (await getPriorShiftGate(date, shift)).waitingOnDayShift;
}

const WAITING_ON_DAY_SHIFT_MESSAGE =
  "The Day shift must be submitted before Night shift entries can be saved. Please wait for Day shift to be completed and committed first.";

// Guard for write handlers, same shape/calling convention as blockIfLocked —
// call it ALONGSIDE that check, never instead of it:
//
//   if (await blockIfLocked(res, date, shift)) return;
//   if (await blockIfPriorShiftPending(res, date, shift)) return;
//
// Kept as its own function rather than merged into getLockState/blockIfLocked
// so the existing "already committed" locks keep their exact current meaning.
export async function blockIfPriorShiftPending(
  res: { status: (code: number) => { json: (body: unknown) => unknown } },
  date: Date,
  shift: Shift
): Promise<boolean> {
  const waiting = await isPriorShiftPending(date, shift);
  if (!waiting) return false;
  res.status(409).json({ message: WAITING_ON_DAY_SHIFT_MESSAGE, waitingOnDayShift: true });
  return true;
}
