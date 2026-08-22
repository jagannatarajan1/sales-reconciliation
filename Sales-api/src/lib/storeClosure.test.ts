import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shift } from "@prisma/client";

// storeClosure.ts is the Issue D data layer: "is this (date, shift) closed",
// and the admin actions that flip that state. Highest-risk logic per the
// plan — these tests cover the guard shapes (FULL_DAY never queries),
// active-vs-inactive semantics (a row can exist yet not currently be
// closed), and the round-trip behaviour setClosure/clearClosure must
// preserve across a close → reopen → re-close cycle.

const findUnique = vi.fn();
const findMany = vi.fn();
const upsert = vi.fn();
const update = vi.fn();

vi.mock("./prisma.js", () => ({
  prisma: {
    storeClosure: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      findMany: (...a: unknown[]) => findMany(...a),
      upsert: (...a: unknown[]) => upsert(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

const { isShiftClosed, getClosure, getClosuresForDate, getClosuresForRange, setClosure, clearClosure } =
  await import("./storeClosure.js");

const DATE = new Date("2026-08-21T00:00:00.000Z");

beforeEach(() => {
  findUnique.mockReset();
  findMany.mockReset();
  upsert.mockReset();
  update.mockReset();
});

describe("isShiftClosed", () => {
  it("is always false for FULL_DAY, without querying", async () => {
    expect(await isShiftClosed(DATE, Shift.FULL_DAY)).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("is false when no row exists", async () => {
    findUnique.mockResolvedValue(null);
    expect(await isShiftClosed(DATE, Shift.DAY)).toBe(false);
  });

  it("is false when a row exists but is inactive (reopened)", async () => {
    findUnique.mockResolvedValue({ active: false });
    expect(await isShiftClosed(DATE, Shift.DAY)).toBe(false);
  });

  it("is true when a row exists and is active", async () => {
    findUnique.mockResolvedValue({ active: true });
    expect(await isShiftClosed(DATE, Shift.NIGHT)).toBe(true);
  });
});

describe("getClosure", () => {
  it("is null for FULL_DAY without querying", async () => {
    expect(await getClosure(DATE, Shift.FULL_DAY)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("is null when the row is inactive", async () => {
    findUnique.mockResolvedValue({ active: false, reason: "old reason" });
    expect(await getClosure(DATE, Shift.DAY)).toBeNull();
  });

  it("returns the full row when active", async () => {
    const row = { active: true, reason: "Bank holiday", closedByName: "Priya" };
    findUnique.mockResolvedValue(row);
    expect(await getClosure(DATE, Shift.DAY)).toBe(row);
  });
});

describe("getClosuresForDate", () => {
  it("returns { day: null, night: null } when nothing is closed", async () => {
    findMany.mockResolvedValue([]);
    expect(await getClosuresForDate(DATE)).toEqual({ day: null, night: null });
  });

  it("splits DAY/NIGHT rows and nulls out inactive ones", async () => {
    findMany.mockResolvedValue([
      { shift: Shift.DAY, active: true, reason: "Holiday" },
      { shift: Shift.NIGHT, active: false, reason: "old" },
    ]);
    const result = await getClosuresForDate(DATE);
    expect(result.day).toMatchObject({ reason: "Holiday" });
    expect(result.night).toBeNull();
  });
});

describe("getClosuresForRange", () => {
  it("groups rows by yyyy-mm-dd, one query for the whole range", async () => {
    findMany.mockResolvedValue([
      { date: new Date("2026-08-20T00:00:00.000Z"), shift: Shift.DAY, active: true, reason: "A" },
      { date: new Date("2026-08-21T00:00:00.000Z"), shift: Shift.NIGHT, active: true, reason: "B" },
    ]);
    const map = await getClosuresForRange(new Date("2026-08-20"), new Date("2026-08-22"));
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(map.get("2026-08-20")?.day).toMatchObject({ reason: "A" });
    expect(map.get("2026-08-20")?.night).toBeNull();
    expect(map.get("2026-08-21")?.night).toMatchObject({ reason: "B" });
    expect(map.has("2026-08-22")).toBe(false);
  });
});

describe("setClosure", () => {
  it("upserts active:true with reason/closedBy/closedAt, clearing reopened* fields on the update branch", async () => {
    upsert.mockResolvedValue({ active: true });
    await setClosure(DATE, Shift.DAY, { reason: "Bank holiday", userId: 5, userName: "Priya" });

    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({ date_shift: { date: DATE, shift: Shift.DAY } });
    expect(call.create).toMatchObject({ active: true, reason: "Bank holiday", closedByUserId: 5, closedByName: "Priya" });
    expect(call.update).toMatchObject({
      active: true,
      reason: "Bank holiday",
      closedByUserId: 5,
      closedByName: "Priya",
      reopenedByUserId: null,
      reopenedByName: null,
      reopenedAt: null,
      reopenReason: null,
    });
  });

  it("rejects FULL_DAY — a whole-day closure must be two DAY/NIGHT rows, never a FULL_DAY row", async () => {
    await expect(setClosure(DATE, Shift.FULL_DAY, { reason: "x", userId: 1, userName: null })).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("clearClosure", () => {
  it("is a safe no-op (cleared: false, no write) on a row that was never closed", async () => {
    findUnique.mockResolvedValue(null);
    const result = await clearClosure(DATE, Shift.DAY, { userId: 5, userName: "Priya" });
    expect(result).toEqual({ cleared: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("is a safe no-op on a row that is already inactive", async () => {
    findUnique.mockResolvedValue({ active: false });
    const result = await clearClosure(DATE, Shift.DAY, { userId: 5, userName: "Priya" });
    expect(result).toEqual({ cleared: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("clears an active closure, stamping reopenedBy*/reopenedAt/reopenReason", async () => {
    findUnique.mockResolvedValue({ active: true, reason: "Bank holiday" });
    update.mockResolvedValue({ active: false });

    const result = await clearClosure(DATE, Shift.NIGHT, { userId: 9, userName: "Owner", reason: "Reopened early" });
    expect(result).toEqual({ cleared: true });
    expect(update).toHaveBeenCalledWith({
      where: { date_shift: { date: DATE, shift: Shift.NIGHT } },
      data: {
        active: false,
        reopenedByUserId: 9,
        reopenedByName: "Owner",
        reopenedAt: expect.any(Date),
        reopenReason: "Reopened early",
      },
    });
  });
});

describe("reopen-then-reclose reactivates", () => {
  it("setClosure after clearClosure sets active:true again via the update branch, clearing the prior reopen record", async () => {
    // Simulates the DB already holding a previously-closed-then-reopened row.
    upsert.mockResolvedValue({ active: true });
    await setClosure(DATE, Shift.DAY, { reason: "Closed again", userId: 3, userName: "Admin Two" });

    const call = upsert.mock.calls[0][0];
    expect(call.update).toMatchObject({ active: true, reason: "Closed again" });
    expect(call.update.reopenedByUserId).toBeNull();
    expect(call.update.reopenedAt).toBeNull();
  });
});
