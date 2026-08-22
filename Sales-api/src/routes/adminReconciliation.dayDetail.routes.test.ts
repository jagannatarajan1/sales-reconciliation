import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";
import { Shift } from "@prisma/client";

// Small, focused coverage for the Issue C addition to
// GET /admin/reconciliation/day/:date: it must now also return
// priorShiftGate, and that value must flip from waitingOnDayShift: true to
// false across a real POST /shift/force-unlock-night call — proving the two
// routes actually agree, not just that each returns a plausible-looking
// value in isolation.
//
// getShiftBreakdown itself (department/VAT/tender/... aggregation) is
// covered elsewhere; it is stubbed out here via importOriginal so this file
// only has to stand up the one Prisma model (ShiftReconciliation, plus
// StoreClosure for the closures/priorShiftGate side) the force-unlock +
// prior-shift-gate path actually touches — the same real entryLock.ts /
// shiftReconciliation.ts logic as adminReconciliation.forceUnlockNight.
// routes.test.ts.

const DATE = new Date("2026-08-21T00:00:00.000Z");
const DATE_STR = "2026-08-21";

function key(date: Date, shift: string) {
  return `${date.toISOString()}|${shift}`;
}

const rows = new Map<string, Record<string, unknown>>();
let nextId = 1;

const shiftReconciliationModel = {
  findUnique: vi.fn(async ({ where: { date_shift } }: { where: { date_shift: { date: Date; shift: string } } }) => {
    return rows.get(key(date_shift.date, date_shift.shift)) ?? null;
  }),
  upsert: vi.fn(
    async ({
      where: { date_shift },
      create,
      update,
    }: {
      where: { date_shift: { date: Date; shift: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const k = key(date_shift.date, date_shift.shift);
      const existing = rows.get(k);
      const row = existing ? { ...existing, ...update } : { shiftReconciliationId: nextId++, ...create };
      rows.set(k, row);
      return row;
    }
  ),
};

// No closures exist in this file's scenarios — findMany always empty, so
// getClosuresForDate/isShiftClosed both read as "nothing closed".
const storeClosureModel = {
  findUnique: vi.fn(async () => null as Record<string, unknown> | null),
  findMany: vi.fn(async () => [] as Record<string, unknown>[]),
};

vi.mock("../lib/prisma.js", () => ({
  prisma: { shiftReconciliation: shiftReconciliationModel, storeClosure: storeClosureModel },
}));

vi.mock("../lib/shiftReconciliation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/shiftReconciliation.js")>();
  return {
    ...actual,
    // Stubbed so this file doesn't have to also stand up dailyTotals.ts /
    // tillReportIngest.ts's full Prisma surface — those aggregation details
    // are covered by tillReportReconciliation.test.ts and friends.
    getShiftBreakdown: vi.fn(async () => ({ shifts: [], xVsZ: null })),
  };
});

const writeAuditLog = vi.fn(async (_input: Record<string, unknown>) => {});
vi.mock("../lib/auditLog.js", () => ({ writeAuditLog: (input: Record<string, unknown>) => writeAuditLog(input) }));

const { adminReconciliationRouter } = await import("./adminReconciliation.routes.js");

let server: ReturnType<express.Express["listen"]>;
let baseUrl: string;

beforeEach(async () => {
  rows.clear();
  nextId = 1;
  shiftReconciliationModel.findUnique.mockClear();
  shiftReconciliationModel.upsert.mockClear();
  storeClosureModel.findUnique.mockClear();
  storeClosureModel.findMany.mockClear();
  writeAuditLog.mockClear();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 42;
    req.userName = "Store Owner";
    req.userRole = "admin";
    req.otpVerified = true;
    req.userPermissions = ["commitHistory"];
    next();
  });
  app.use("/api/admin/reconciliation", adminReconciliationRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/admin/reconciliation`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("GET /admin/reconciliation/day/:date", () => {
  it("includes priorShiftGate, and it flips true→false across a real force-unlock", async () => {
    // 1. Before anything: Day has no ShiftReconciliation row at all, so
    //    Night is genuinely waiting.
    const before = await fetch(`${baseUrl}/day/${DATE_STR}`);
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as Record<string, unknown>;
    expect(beforeBody.priorShiftGate).toEqual({ waitingOnDayShift: true, dayShiftHasEntries: false });
    expect(beforeBody.closures).toEqual({ day: null, night: null });

    // 2. Force-unlock Night via the real route.
    const unlockRes = await fetch(`${baseUrl}/shift/force-unlock-night`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: DATE_STR, reason: "Day staff unavailable" }),
    });
    expect(unlockRes.status).toBe(200);

    // 3. GET /day/:date now reports the gate as satisfied — same live
    //    lookup, not a cached/stale value.
    const after = await fetch(`${baseUrl}/day/${DATE_STR}`);
    const afterBody = (await after.json()) as Record<string, unknown>;
    expect(afterBody.priorShiftGate).toEqual({ waitingOnDayShift: false, dayShiftHasEntries: false });
  });

  it("waitingOnDayShift is also false once Day is genuinely staff-committed (not just via force-unlock)", async () => {
    rows.set(key(DATE, Shift.DAY), { shiftReconciliationId: 5, isShiftCommitted: true, hasEntries: true });

    const res = await fetch(`${baseUrl}/day/${DATE_STR}`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.priorShiftGate).toEqual({ waitingOnDayShift: false, dayShiftHasEntries: true });
  });
});
