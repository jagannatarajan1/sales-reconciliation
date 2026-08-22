import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";
import { Shift } from "@prisma/client";

// End-to-end coverage of POST /admin/reconciliation/closure and
// POST /admin/reconciliation/closure/reopen: real router, real
// storeClosure.ts logic, only prisma + the audit log writer swapped for
// test doubles — the same shape as adminReconciliation.forceUnlockNight.
// routes.test.ts. Covers the two things this feature spec calls out as
// non-negotiable: scope 'FULL_DAY' creates exactly two DAY/NIGHT rows
// (never a shift=FULL_DAY row), and the C/D interaction — marking Day
// closed with zero pre-existing ShiftReconciliation rows satisfies the
// Day→Night prior-shift gate.

const DATE = new Date("2026-08-21T00:00:00.000Z");
const DATE_STR = "2026-08-21";

function key(date: Date, shift: string) {
  return `${date.toISOString()}|${shift}`;
}

const closureRows = new Map<string, Record<string, unknown>>();
let nextClosureId = 1;

const storeClosureModel = {
  findUnique: vi.fn(async ({ where: { date_shift } }: { where: { date_shift: { date: Date; shift: string } } }) => {
    return closureRows.get(key(date_shift.date, date_shift.shift)) ?? null;
  }),
  findMany: vi.fn(async ({ where }: { where: { date: Date; shift?: { in: string[] } } }) => {
    return [...closureRows.values()].filter(
      (r) => (r.date as Date).toISOString() === where.date.toISOString()
    );
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
      const existing = closureRows.get(k);
      const row = existing ? { ...existing, ...update } : { storeClosureId: nextClosureId++, ...create };
      closureRows.set(k, row);
      return row;
    }
  ),
  update: vi.fn(
    async ({
      where: { date_shift },
      data,
    }: {
      where: { date_shift: { date: Date; shift: string } };
      data: Record<string, unknown>;
    }) => {
      const k = key(date_shift.date, date_shift.shift);
      const row = { ...(closureRows.get(k) ?? {}), ...data };
      closureRows.set(k, row);
      return row;
    }
  ),
};

// No genuine staff commits exist in any of these scenarios — findUnique
// always null, so getPriorShiftGate's non-closure half reads as "never
// committed" throughout, isolating what the closure alone contributes.
const shiftReconciliationModel = { findUnique: vi.fn(async () => null as Record<string, unknown> | null) };

vi.mock("../lib/prisma.js", () => ({
  prisma: { storeClosure: storeClosureModel, shiftReconciliation: shiftReconciliationModel },
}));

vi.mock("../lib/shiftReconciliation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/shiftReconciliation.js")>();
  return { ...actual, getShiftBreakdown: vi.fn(async () => ({ shifts: [], xVsZ: null })) };
});

const writeAuditLog = vi.fn(async (_input: Record<string, unknown>) => {});
vi.mock("../lib/auditLog.js", () => ({ writeAuditLog: (input: Record<string, unknown>) => writeAuditLog(input) }));

const { adminReconciliationRouter } = await import("./adminReconciliation.routes.js");
const { isPriorShiftPending } = await import("../lib/entryLock.js");

let server: ReturnType<express.Express["listen"]>;
let baseUrl: string;

beforeEach(async () => {
  closureRows.clear();
  nextClosureId = 1;
  storeClosureModel.findUnique.mockClear();
  storeClosureModel.findMany.mockClear();
  storeClosureModel.upsert.mockClear();
  storeClosureModel.update.mockClear();
  shiftReconciliationModel.findUnique.mockClear();
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

describe("POST /closure", () => {
  it("requires a reason", async () => {
    const res = await fetch(`${baseUrl}/closure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: DATE_STR, scope: "DAY" }),
    });
    expect(res.status).toBe(400);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("requires date and a valid scope", async () => {
    const res = await fetch(`${baseUrl}/closure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: DATE_STR, scope: "NOT_A_SCOPE", reason: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("scope DAY closes exactly the Day row", async () => {
    const res = await fetch(`${baseUrl}/closure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: DATE_STR, scope: "DAY", reason: "Staff illness" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.scope).toBe("DAY");
    expect(closureRows.has(key(DATE, Shift.DAY))).toBe(true);
    expect(closureRows.has(key(DATE, Shift.NIGHT))).toBe(false);
    expect(closureRows.get(key(DATE, Shift.DAY))).toMatchObject({
      active: true,
      reason: "Staff illness",
      closedByUserId: 42,
      closedByName: "Store Owner",
    });

    const auditCall = writeAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(auditCall.action).toBe("store_closure_mark");
  });

  // The literal non-negotiable: scope FULL_DAY creates exactly two rows
  // (DAY + NIGHT), NEVER a shift=FULL_DAY row — the StoreClosure model has
  // no FULL_DAY-shaped row to create in the first place.
  it("scope FULL_DAY creates exactly two rows (DAY and NIGHT), never a FULL_DAY row", async () => {
    const res = await fetch(`${baseUrl}/closure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: DATE_STR, scope: "FULL_DAY", reason: "Bank holiday" }),
    });
    expect(res.status).toBe(200);

    expect(closureRows.size).toBe(2);
    expect(closureRows.has(key(DATE, Shift.DAY))).toBe(true);
    expect(closureRows.has(key(DATE, Shift.NIGHT))).toBe(true);
    expect(closureRows.has(key(DATE, Shift.FULL_DAY))).toBe(false);
    for (const row of closureRows.values()) {
      expect(row.shift).not.toBe(Shift.FULL_DAY);
      expect(row.active).toBe(true);
      expect(row.reason).toBe("Bank holiday");
    }
  });

  // The direct C/D interaction, proven end-to-end: marking Day closed with
  // ZERO pre-existing ShiftReconciliation rows must satisfy the Day→Night
  // gate immediately.
  it("marking Day closed with zero pre-existing ShiftReconciliation rows makes isPriorShiftPending(NIGHT) false", async () => {
    expect(await isPriorShiftPending(DATE, Shift.NIGHT)).toBe(true);

    const res = await fetch(`${baseUrl}/closure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: DATE_STR, scope: "DAY", reason: "Staff illness" }),
    });
    expect(res.status).toBe(200);

    expect(await isPriorShiftPending(DATE, Shift.NIGHT)).toBe(false);
  });
});

describe("POST /closure/reopen", () => {
  it("requires date and a valid scope", async () => {
    const res = await fetch(`${baseUrl}/closure/reopen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "DAY" }),
    });
    expect(res.status).toBe(400);
  });

  it("is a safe no-op (cleared: false) reopening a date that was never closed", async () => {
    const res = await fetch(`${baseUrl}/closure/reopen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: DATE_STR, scope: "DAY" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.cleared).toBe(false);
    expect(storeClosureModel.update).not.toHaveBeenCalled();
  });

  it("reopens a closed Day, restoring isPriorShiftPending(NIGHT) to true", async () => {
    await fetch(`${baseUrl}/closure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: DATE_STR, scope: "DAY", reason: "Staff illness" }),
    });
    expect(await isPriorShiftPending(DATE, Shift.NIGHT)).toBe(false);

    const res = await fetch(`${baseUrl}/closure/reopen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: DATE_STR, scope: "DAY", reason: "Staff came in after all" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.cleared).toBe(true);

    expect(await isPriorShiftPending(DATE, Shift.NIGHT)).toBe(true);
    expect(closureRows.get(key(DATE, Shift.DAY))).toMatchObject({ active: false });

    const auditCall = writeAuditLog.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(auditCall.action).toBe("store_closure_unmark");
  });

  // Close → reopen → re-close must reactivate cleanly (reopen-then-reclose
  // is explicitly called out as a scenario to prove, not just close-once).
  it("close → reopen → re-close reactivates the same row", async () => {
    const post = (path: string, body: unknown) =>
      fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    await post("/closure", { date: DATE_STR, scope: "DAY", reason: "First closure" });
    await post("/closure/reopen", { date: DATE_STR, scope: "DAY" });
    await post("/closure", { date: DATE_STR, scope: "DAY", reason: "Second closure" });

    const row = closureRows.get(key(DATE, Shift.DAY));
    expect(row).toMatchObject({ active: true, reason: "Second closure" });
    expect(row?.reopenedByUserId).toBeNull();
    expect(row?.reopenedAt).toBeNull();
  });
});
