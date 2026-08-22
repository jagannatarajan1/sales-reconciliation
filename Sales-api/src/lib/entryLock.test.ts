import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shift } from "@prisma/client";

// getLockState composes two independent lookups, and the composition is where
// the bugs would live — a shift lock that forgets the day lock would let staff
// edit a committed day, and reporting the shift reason over the day reason
// would tell them to re-open a shift that is not the thing blocking them.
const findReconciliation = vi.fn();
const findShift = vi.fn();
// storeClosure.ts's isShiftClosed does its own select-only findUnique on
// prisma.storeClosure — mocked separately so getPriorShiftGate's "zero
// queries for DAY/FULL_DAY" guarantee can be asserted against it too.
const findClosure = vi.fn();

vi.mock("./prisma.js", () => ({
  prisma: {
    reconciliationRecord: { findUnique: (...a: unknown[]) => findReconciliation(...a) },
    shiftReconciliation: { findUnique: (...a: unknown[]) => findShift(...a) },
    storeClosure: { findUnique: (...a: unknown[]) => findClosure(...a) },
  },
}));

const {
  getLockState,
  isDayLocked,
  isShiftCommitted,
  isPriorShiftPending,
  getPriorShiftGate,
  blockIfPriorShiftPending,
} = await import("./entryLock.js");

const DATE = new Date("2026-08-21T00:00:00.000Z");

beforeEach(() => {
  findReconciliation.mockReset();
  findShift.mockReset();
  findClosure.mockReset();
  findReconciliation.mockResolvedValue(null);
  findShift.mockResolvedValue(null);
  // Not closed by default — every existing test that never mentions closure
  // keeps meaning exactly what it did before this feature existed.
  findClosure.mockResolvedValue(null);
});

describe("isDayLocked", () => {
  it("is false when the day has no record at all", async () => {
    expect(await isDayLocked(DATE)).toBe(false);
  });

  it("is true once staff have committed", async () => {
    findReconciliation.mockResolvedValue({ isStaffCommitted: true, isAdminReconciled: false });
    expect(await isDayLocked(DATE)).toBe(true);
  });

  // evaluateDay upserts a ReconciliationRecord with neither flag set, purely to
  // hold the X-vs-Z figures. Those phantom rows must not read as committed.
  it("is false for a record that exists but has neither flag", async () => {
    findReconciliation.mockResolvedValue({ isStaffCommitted: false, isAdminReconciled: false });
    expect(await isDayLocked(DATE)).toBe(false);
  });

  it("is true when only the admin has reconciled", async () => {
    findReconciliation.mockResolvedValue({ isStaffCommitted: false, isAdminReconciled: true });
    expect(await isDayLocked(DATE)).toBe(true);
  });
});

describe("isShiftCommitted", () => {
  it("is always false for FULL_DAY, without querying", async () => {
    expect(await isShiftCommitted(DATE, Shift.FULL_DAY)).toBe(false);
    expect(findShift).not.toHaveBeenCalled();
  });

  it("reads the flag for a real shift", async () => {
    findShift.mockResolvedValue({ isShiftCommitted: true });
    expect(await isShiftCommitted(DATE, Shift.DAY)).toBe(true);
  });
});

describe("getLockState", () => {
  it("is unlocked when neither lock applies", async () => {
    const state = await getLockState(DATE, Shift.DAY);
    expect(state).toMatchObject({ dayLocked: false, shiftLocked: false, locked: false, reason: null });
  });

  it("locks the shift when only the shift is committed", async () => {
    findShift.mockResolvedValue({ isShiftCommitted: true });
    const state = await getLockState(DATE, Shift.DAY);
    expect(state.locked).toBe(true);
    expect(state.dayLocked).toBe(false);
    expect(state.reason).toMatch(/shift has been committed/i);
  });

  // The day lock is the stronger statement and the one an admin has to undo,
  // so it must win the message even when both are on.
  it("reports the day reason when both locks apply", async () => {
    findReconciliation.mockResolvedValue({ isStaffCommitted: true, isAdminReconciled: false });
    findShift.mockResolvedValue({ isShiftCommitted: true });
    const state = await getLockState(DATE, Shift.NIGHT);
    expect(state).toMatchObject({ dayLocked: true, shiftLocked: true, locked: true });
    expect(state.reason).toMatch(/day has been committed/i);
  });

  // Committing a day must freeze both its shifts even though neither shift was
  // individually signed off.
  it("locks an uncommitted shift inside a committed day", async () => {
    findReconciliation.mockResolvedValue({ isStaffCommitted: true, isAdminReconciled: false });
    const state = await getLockState(DATE, Shift.NIGHT);
    expect(state.locked).toBe(true);
    expect(state.shiftLocked).toBe(false);
  });
});

// isPriorShiftPending/getPriorShiftGate are a SEPARATE concept from the
// locks above: not "already submitted, no more edits" but "hasn't had its
// turn yet" — Night waiting on Day's staff commit. Reuses the same
// `findShift` mock as isShiftCommitted above since both call
// prisma.shiftReconciliation.findUnique, just for different (date, shift)
// keys under the hood.
describe("isPriorShiftPending / getPriorShiftGate", () => {
  it("is always false for DAY — nothing precedes the first shift", async () => {
    expect(await isPriorShiftPending(DATE, Shift.DAY)).toBe(false);
    expect(findShift).not.toHaveBeenCalled();
    expect(findClosure).not.toHaveBeenCalled();
  });

  it("is always false for FULL_DAY — the two-shift sequence doesn't exist while the split is off", async () => {
    expect(await isPriorShiftPending(DATE, Shift.FULL_DAY)).toBe(false);
    expect(findShift).not.toHaveBeenCalled();
    expect(findClosure).not.toHaveBeenCalled();
  });

  // The "no row exists yet at all" case must read as pending/locked, never
  // as an error and never as an implicit pass — Day simply hasn't happened
  // yet is the most common real case (start of the Night window on a fresh
  // business date).
  it("is true for NIGHT when Day has no ShiftReconciliation row at all", async () => {
    findShift.mockResolvedValue(null);
    expect(await isPriorShiftPending(DATE, Shift.NIGHT)).toBe(true);
  });

  it("is true for NIGHT when Day's row exists but isShiftCommitted is false", async () => {
    findShift.mockResolvedValue({ isShiftCommitted: false, hasEntries: true });
    expect(await isPriorShiftPending(DATE, Shift.NIGHT)).toBe(true);
  });

  it("is false for NIGHT once Day has been staff-committed", async () => {
    findShift.mockResolvedValue({ isShiftCommitted: true, hasEntries: true });
    expect(await isPriorShiftPending(DATE, Shift.NIGHT)).toBe(false);
  });

  it("getPriorShiftGate surfaces whether Day has any entries yet, for the waiting message", async () => {
    findShift.mockResolvedValue({ isShiftCommitted: false, hasEntries: false });
    expect(await getPriorShiftGate(DATE, Shift.NIGHT)).toEqual({
      waitingOnDayShift: true,
      dayShiftHasEntries: false,
    });

    findShift.mockResolvedValue({ isShiftCommitted: false, hasEntries: true });
    expect(await getPriorShiftGate(DATE, Shift.NIGHT)).toEqual({
      waitingOnDayShift: true,
      dayShiftHasEntries: true,
    });
  });

  it("getPriorShiftGate is the fixed not-waiting value for DAY/FULL_DAY without querying", async () => {
    expect(await getPriorShiftGate(DATE, Shift.DAY)).toEqual({ waitingOnDayShift: false, dayShiftHasEntries: false });
    expect(await getPriorShiftGate(DATE, Shift.FULL_DAY)).toEqual({
      waitingOnDayShift: false,
      dayShiftHasEntries: false,
    });
    expect(findShift).not.toHaveBeenCalled();
    // The new closure lookup must never run for DAY/FULL_DAY either —
    // extends the existing zero-queries guarantee to Issue D's addition.
    expect(findClosure).not.toHaveBeenCalled();
  });

  // Issue C/D interaction: a Day marked Closed satisfies the gate exactly
  // like a genuine staff commit would, even when Day never had a single
  // ShiftReconciliation row (nobody was ever going to submit a closed Day).
  it("Day closed → waitingOnDayShift false even with zero ShiftReconciliation rows at all", async () => {
    findShift.mockResolvedValue(null);
    findClosure.mockResolvedValue({ active: true });

    expect(await getPriorShiftGate(DATE, Shift.NIGHT)).toEqual({
      waitingOnDayShift: false,
      dayShiftHasEntries: false,
    });
    expect(await isPriorShiftPending(DATE, Shift.NIGHT)).toBe(false);
  });

  it("Day closed still surfaces dayShiftHasEntries truthfully if Day had entries before being closed", async () => {
    findShift.mockResolvedValue({ isShiftCommitted: false, hasEntries: true });
    findClosure.mockResolvedValue({ active: true });

    expect(await getPriorShiftGate(DATE, Shift.NIGHT)).toEqual({
      waitingOnDayShift: false,
      dayShiftHasEntries: true,
    });
  });

  it("an inactive (reopened) closure row does not satisfy the gate — Day is still waited on", async () => {
    findShift.mockResolvedValue(null);
    findClosure.mockResolvedValue({ active: false });

    expect(await getPriorShiftGate(DATE, Shift.NIGHT)).toEqual({
      waitingOnDayShift: true,
      dayShiftHasEntries: false,
    });
  });
});

describe("blockIfPriorShiftPending", () => {
  function mockRes() {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    return { status, json };
  }

  it("does nothing and returns false when Night is not waiting on Day", async () => {
    findShift.mockResolvedValue({ isShiftCommitted: true });
    const res = mockRes();
    expect(await blockIfPriorShiftPending(res, DATE, Shift.NIGHT)).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("never blocks DAY or FULL_DAY", async () => {
    const res = mockRes();
    expect(await blockIfPriorShiftPending(res, DATE, Shift.DAY)).toBe(false);
    expect(await blockIfPriorShiftPending(res, DATE, Shift.FULL_DAY)).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 409 with waitingOnDayShift and returns true when Day is not yet committed", async () => {
    findShift.mockResolvedValue(null);
    const res = mockRes();
    expect(await blockIfPriorShiftPending(res, DATE, Shift.NIGHT)).toBe(true);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ waitingOnDayShift: true, message: expect.stringMatching(/day shift/i) })
    );
  });
});
