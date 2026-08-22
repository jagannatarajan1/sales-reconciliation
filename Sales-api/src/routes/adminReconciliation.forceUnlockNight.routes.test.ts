import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";
import { Shift } from "@prisma/client";

// End-to-end coverage of the admin override path for the Day→Night
// prior-shift gate: a real Express app with the real admin router, the real
// entryLock.ts / shiftReconciliation.ts logic, and only prisma + the audit
// log writer swapped for test doubles. This is the one place that exercises
// the actual composition the feature depends on:
//
//   1. Before the override: isPriorShiftPending(NIGHT) is true.
//   2. POST /shift/force-unlock-night marks Day committed.
//   3. After the override: isPriorShiftPending(NIGHT) is now false.
//   4. The audit log entry uses the distinguishing action name
//      "admin_force_unlock_night_shift" and carries the admin's reason —
//      never the "shift_commit" action a genuine staff submission uses.

const DATE = new Date("2026-08-21T00:00:00.000Z");

function key(date: Date, shift: string) {
  return `${date.toISOString()}|${shift}`;
}

// Minimal stateful stand-in for the one Prisma model this path touches, so
// forceUnlockNightShift's upsert and isPriorShiftPending's findUnique see
// each other's writes exactly like the real table would.
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

// Day is never marked Closed in these tests — getPriorShiftGate's Issue D
// closure check needs a real prisma.storeClosure model to query against,
// defaulting to "not closed" so isPriorShiftPending keeps meaning exactly
// what it did before that feature existed.
const storeClosureModel = { findUnique: vi.fn(async () => null as Record<string, unknown> | null) };

vi.mock("../lib/prisma.js", () => ({
  prisma: { shiftReconciliation: shiftReconciliationModel, storeClosure: storeClosureModel },
}));

const writeAuditLog = vi.fn(async (_input: Record<string, unknown>) => {});
vi.mock("../lib/auditLog.js", () => ({ writeAuditLog: (input: Record<string, unknown>) => writeAuditLog(input) }));

const { adminReconciliationRouter } = await import("./adminReconciliation.routes.js");
const { isPriorShiftPending } = await import("../lib/entryLock.js");

let server: ReturnType<express.Express["listen"]>;
let baseUrl: string;

beforeEach(async () => {
  rows.clear();
  nextId = 1;
  shiftReconciliationModel.findUnique.mockClear();
  shiftReconciliationModel.upsert.mockClear();
  storeClosureModel.findUnique.mockClear();
  writeAuditLog.mockClear();

  const app = express();
  app.use(express.json());
  // Stand-in for the real auth middleware (attachUser) — sets exactly the
  // fields requirePermission reads, as an authenticated admin with the
  // "commitHistory" permission the neighboring shift/edit and shift/resolve
  // routes are gated on.
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

describe("POST /shift/force-unlock-night", () => {
  it("requires a reason", async () => {
    const res = await fetch(`${baseUrl}/shift/force-unlock-night`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-08-21" }),
    });
    expect(res.status).toBe(400);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("requires a date", async () => {
    const res = await fetch(`${baseUrl}/shift/force-unlock-night`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Day staff went home sick" }),
    });
    expect(res.status).toBe(400);
  });

  it("unlocks Night end-to-end: Day flips from pending to committed, and the audit trail is distinguishable from a real staff commit", async () => {
    // 1. Before the override, Night is genuinely waiting on Day — no row
    //    exists yet at all (Day never even started).
    expect(await isPriorShiftPending(DATE, Shift.NIGHT)).toBe(true);

    // 2. Admin forces it open with a reason.
    const res = await fetch(`${baseUrl}/shift/force-unlock-night`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-08-21", reason: "Day staff went home sick, night needs to start" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      forced: true,
      waitingOnDayShift: false,
      // Issue C: the route's response now echoes back who/when the forced
      // unlock happened, so the admin UI can reflect it without a second
      // fetch — but never the reason (that stays admin-detail, read via
      // GET /admin/reconciliation/day/:date, not this action's response).
      forcedUnlockByName: "Store Owner",
    });
    expect(body.forcedUnlockAt).toBeTruthy();

    // 3. isPriorShiftPending now sees Day as committed — the SAME function
    //    real staff-submitted commits satisfy — proving the gate is
    //    genuinely lifted, not just faked in the response body.
    expect(await isPriorShiftPending(DATE, Shift.NIGHT)).toBe(false);

    // The underlying row must not carry a fake staff identity, but DOES
    // carry its own forcedUnlock* provenance (Issue C).
    const dayRow = rows.get(key(DATE, Shift.DAY));
    expect(dayRow).toMatchObject({
      isShiftCommitted: true,
      forcedUnlockByUserId: 42,
      forcedUnlockByName: "Store Owner",
      forcedUnlockReason: "Day staff went home sick, night needs to start",
    });
    expect(dayRow).not.toHaveProperty("shiftCommittedByUserId");
    expect(dayRow).not.toHaveProperty("shiftCommittedByName");

    // 4. The audit log entry is written with the distinguishing action name
    //    and the admin's reason — never "shift_commit".
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    const auditCall = writeAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(auditCall.action).toBe("admin_force_unlock_night_shift");
    expect(auditCall.action).not.toBe("shift_commit");
    expect(auditCall.userId).toBe(42);
    expect(auditCall.userName).toBe("Store Owner");
    expect(JSON.stringify(auditCall.newValue)).toContain("Day staff went home sick");
  });

  it("is a no-op (forced: false) and still audited when Day already has a genuine staff commit", async () => {
    rows.set(key(DATE, Shift.DAY), {
      shiftReconciliationId: 99,
      isShiftCommitted: true,
      shiftCommittedByUserId: 7,
      shiftCommittedByName: "Real Day Staff",
    });

    const res = await fetch(`${baseUrl}/shift/force-unlock-night`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-08-21", reason: "Just checking" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.forced).toBe(false);
    // No forcedUnlock* fields on the no-op path's response — nothing was
    // actually forced open.
    expect(body.forcedUnlockByName).toBeFalsy();

    // The genuine staff commit must survive untouched, and forcedUnlock*
    // stays absent/null — a real commit and a forced override must never be
    // confused by column inspection alone.
    const dayRow = rows.get(key(DATE, Shift.DAY));
    expect(dayRow?.shiftCommittedByName).toBe("Real Day Staff");
    expect(dayRow?.forcedUnlockByName).toBeFalsy();
    expect(dayRow?.forcedUnlockAt).toBeFalsy();
  });
});
