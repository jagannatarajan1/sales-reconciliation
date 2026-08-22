import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shift } from "@prisma/client";

// forceUnlockNightShift is the admin safety valve for the Day→Night
// prior-shift gate (isPriorShiftPending in entryLock.ts). These tests focus
// on the two properties the feature spec calls out as non-negotiable:
//   1. It marks Day committed so isPriorShiftPending flips to false — even
//      when Day has no ShiftReconciliation row at all yet.
//   2. It never writes shiftCommittedByUserId/Name/At the way a genuine
//      staff commit does, so a forced-open row can never be mistaken for a
//      real submission just by inspecting those columns.
// The audit-log side of "who forced this open and why" is owned by the route
// handler (POST /admin/reconciliation/shift/force-unlock-night), not this
// function — covered separately in adminReconciliation.routes.test.ts.

const findShift = vi.fn();
const upsertShift = vi.fn();

vi.mock("./prisma.js", () => ({
  prisma: {
    shiftReconciliation: {
      findUnique: (...a: unknown[]) => findShift(...a),
      upsert: (...a: unknown[]) => upsertShift(...a),
    },
  },
}));

const { forceUnlockNightShift } = await import("./shiftReconciliation.js");

const DATE = new Date("2026-08-21T00:00:00.000Z");

beforeEach(() => {
  findShift.mockReset();
  upsertShift.mockReset();
});

describe("forceUnlockNightShift", () => {
  it("marks Day committed when there is no ShiftReconciliation row at all yet", async () => {
    findShift.mockResolvedValue(null);
    upsertShift.mockResolvedValue({
      shiftReconciliationId: 1,
      date: DATE,
      shift: Shift.DAY,
      isShiftCommitted: true,
    });

    const result = await forceUnlockNightShift(DATE);

    expect(result.forced).toBe(true);
    expect(result.row.isShiftCommitted).toBe(true);
    expect(upsertShift).toHaveBeenCalledWith({
      where: { date_shift: { date: DATE, shift: Shift.DAY } },
      create: { date: DATE, shift: Shift.DAY, isShiftCommitted: true },
      update: { isShiftCommitted: true },
    });
  });

  it("marks Day committed when a row exists but was never staff-committed", async () => {
    findShift.mockResolvedValue({ shiftReconciliationId: 2, isShiftCommitted: false });
    upsertShift.mockResolvedValue({ shiftReconciliationId: 2, isShiftCommitted: true });

    const result = await forceUnlockNightShift(DATE);

    expect(result.forced).toBe(true);
    expect(upsertShift).toHaveBeenCalled();
  });

  // Must never silently clobber a genuine staff submission.
  it("is a no-op when Day already carries a real staff commit", async () => {
    const existing = { shiftReconciliationId: 3, isShiftCommitted: true, shiftCommittedByName: "Priya" };
    findShift.mockResolvedValue(existing);

    const result = await forceUnlockNightShift(DATE);

    expect(result.forced).toBe(false);
    expect(result.row).toBe(existing);
    expect(upsertShift).not.toHaveBeenCalled();
  });

  // The row must not read as a genuine staff sign-off afterwards — no
  // shiftCommittedByUserId/Name/At/shiftStaffNotes written by this path.
  it("never writes the staff shift-commit columns", async () => {
    findShift.mockResolvedValue(null);
    upsertShift.mockResolvedValue({ shiftReconciliationId: 4, isShiftCommitted: true });

    await forceUnlockNightShift(DATE);

    const call = upsertShift.mock.calls[0][0];
    expect(call.create).not.toHaveProperty("shiftCommittedByUserId");
    expect(call.create).not.toHaveProperty("shiftCommittedByName");
    expect(call.create).not.toHaveProperty("shiftCommittedAt");
    expect(call.update).toEqual({ isShiftCommitted: true });
  });
});
