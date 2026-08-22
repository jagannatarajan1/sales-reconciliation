import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shift } from "@prisma/client";

// forceUnlockNightShift is the admin safety valve for the Day→Night
// prior-shift gate (isPriorShiftPending in entryLock.ts). These tests focus
// on the properties the feature spec calls out as non-negotiable:
//   1. It marks Day committed so isPriorShiftPending flips to false — even
//      when Day has no ShiftReconciliation row at all yet.
//   2. It never writes shiftCommittedByUserId/Name/At the way a genuine
//      staff commit does, so a forced-open row can never be mistaken for a
//      real submission just by inspecting those columns.
//   3. (Issue C) It DOES persist its own forcedUnlockByUserId/Name/At/Reason
//      columns on the force branch, and leaves them untouched (never
//      overwritten to null) on the already-committed no-op branch.
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
const INPUT = { reason: "Day staff called in sick", userId: 42, userName: "Store Owner" };

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

    const result = await forceUnlockNightShift(DATE, INPUT);

    expect(result.forced).toBe(true);
    expect(result.row.isShiftCommitted).toBe(true);
    expect(upsertShift).toHaveBeenCalledWith({
      where: { date_shift: { date: DATE, shift: Shift.DAY } },
      create: {
        date: DATE,
        shift: Shift.DAY,
        isShiftCommitted: true,
        forcedUnlockByUserId: 42,
        forcedUnlockByName: "Store Owner",
        forcedUnlockAt: expect.any(Date),
        forcedUnlockReason: "Day staff called in sick",
      },
      update: {
        isShiftCommitted: true,
        forcedUnlockByUserId: 42,
        forcedUnlockByName: "Store Owner",
        forcedUnlockAt: expect.any(Date),
        forcedUnlockReason: "Day staff called in sick",
      },
    });
  });

  it("marks Day committed when a row exists but was never staff-committed", async () => {
    findShift.mockResolvedValue({ shiftReconciliationId: 2, isShiftCommitted: false });
    upsertShift.mockResolvedValue({ shiftReconciliationId: 2, isShiftCommitted: true });

    const result = await forceUnlockNightShift(DATE, INPUT);

    expect(result.forced).toBe(true);
    expect(upsertShift).toHaveBeenCalled();
  });

  // Must never silently clobber a genuine staff submission — including its
  // (necessarily null) forcedUnlock* columns.
  it("is a no-op when Day already carries a real staff commit", async () => {
    const existing = {
      shiftReconciliationId: 3,
      isShiftCommitted: true,
      shiftCommittedByName: "Priya",
      forcedUnlockByName: null,
      forcedUnlockAt: null,
      forcedUnlockReason: null,
    };
    findShift.mockResolvedValue(existing);

    const result = await forceUnlockNightShift(DATE, INPUT);

    expect(result.forced).toBe(false);
    expect(result.row).toBe(existing);
    expect(result.row.forcedUnlockByName).toBeNull();
    expect(upsertShift).not.toHaveBeenCalled();
  });

  // The row must not read as a genuine staff sign-off afterwards — no
  // shiftCommittedByUserId/Name/At/shiftStaffNotes written by this path —
  // but it DOES persist the four forcedUnlock* columns as its own distinct
  // "who/when/why" record.
  it("never writes the staff shift-commit columns, but does persist forcedUnlock*", async () => {
    findShift.mockResolvedValue(null);
    upsertShift.mockResolvedValue({ shiftReconciliationId: 4, isShiftCommitted: true });

    await forceUnlockNightShift(DATE, INPUT);

    const call = upsertShift.mock.calls[0][0];
    expect(call.create).not.toHaveProperty("shiftCommittedByUserId");
    expect(call.create).not.toHaveProperty("shiftCommittedByName");
    expect(call.create).not.toHaveProperty("shiftCommittedAt");
    expect(call.create).toMatchObject({
      isShiftCommitted: true,
      forcedUnlockByUserId: 42,
      forcedUnlockByName: "Store Owner",
      forcedUnlockReason: "Day staff called in sick",
    });
    expect(call.update).toMatchObject({
      isShiftCommitted: true,
      forcedUnlockByUserId: 42,
      forcedUnlockByName: "Store Owner",
      forcedUnlockReason: "Day staff called in sick",
    });
    expect(call.update).not.toHaveProperty("shiftCommittedByUserId");
  });

  it("passes through a null userName unchanged", async () => {
    findShift.mockResolvedValue(null);
    upsertShift.mockResolvedValue({ shiftReconciliationId: 5, isShiftCommitted: true });

    await forceUnlockNightShift(DATE, { reason: "x", userId: 7, userName: null });

    const call = upsertShift.mock.calls[0][0];
    expect(call.create.forcedUnlockByName).toBeNull();
  });
});
