import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shift } from "@prisma/client";

// getLockState composes two independent lookups, and the composition is where
// the bugs would live — a shift lock that forgets the day lock would let staff
// edit a committed day, and reporting the shift reason over the day reason
// would tell them to re-open a shift that is not the thing blocking them.
const findReconciliation = vi.fn();
const findShift = vi.fn();

vi.mock("./prisma.js", () => ({
  prisma: {
    reconciliationRecord: { findUnique: (...a: unknown[]) => findReconciliation(...a) },
    shiftReconciliation: { findUnique: (...a: unknown[]) => findShift(...a) },
  },
}));

const { getLockState, isDayLocked, isShiftCommitted } = await import("./entryLock.js");

const DATE = new Date("2026-08-21T00:00:00.000Z");

beforeEach(() => {
  findReconciliation.mockReset();
  findShift.mockReset();
  findReconciliation.mockResolvedValue(null);
  findShift.mockResolvedValue(null);
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
