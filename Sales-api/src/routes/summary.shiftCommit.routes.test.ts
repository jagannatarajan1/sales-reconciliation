import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";
import { Shift } from "@prisma/client";

// Covers the new 409 guard on POST /Summary/shift-commit: Night must not be
// committable while it is still waiting on Day (isPriorShiftPending), the
// same gate that hides the entry form on the frontend. Real router, real
// entryLock.ts logic — only prisma is a test double, kept deliberately
// minimal since the guard returns before touching anything else the route
// would otherwise need (computeShiftTotals, evaluateAndNotify, etc.).

const DATE_STR = "2026-08-21";

const activeDateOverride = {
  findUnique: vi.fn(async () => ({
    id: 1,
    activeDate: new Date(`${DATE_STR}T00:00:00.000Z`),
    activeShift: Shift.NIGHT,
  })),
};

const dayShiftRow = vi.fn(async () => null as Record<string, unknown> | null);
const shiftReconciliation = {
  findUnique: vi.fn(async (args: { where: { date_shift: { shift: string } } }) => {
    if (args.where.date_shift.shift === Shift.DAY) return dayShiftRow();
    return null;
  }),
  upsert: vi.fn(async () => {
    throw new Error("upsert should not be reached when Day is still pending");
  }),
};

vi.mock("../lib/prisma.js", () => ({
  prisma: { activeDateOverride, shiftReconciliation },
}));

const { summaryRouter } = await import("./summary.routes.js");

let server: ReturnType<express.Express["listen"]>;
let baseUrl: string;

beforeAll(() => {
  process.env.SHIFT_ENTRY_ENABLED = "true";
});

afterAll(() => {
  delete process.env.SHIFT_ENTRY_ENABLED;
});

beforeEach(async () => {
  dayShiftRow.mockResolvedValue(null);
  shiftReconciliation.findUnique.mockClear();
  shiftReconciliation.upsert.mockClear();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 5;
    req.userName = "Night Staff";
    next();
  });
  app.use("/api/Summary", summaryRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/Summary`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("POST /Summary/shift-commit — prior-shift gate", () => {
  it("rejects with 409 when Night tries to commit before Day has any ShiftReconciliation row at all", async () => {
    dayShiftRow.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/shift-commit`, { method: "POST" });

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.waitingOnDayShift).toBe(true);
    expect(body.message).toMatch(/day shift/i);
    expect(shiftReconciliation.upsert).not.toHaveBeenCalled();
  });

  it("rejects with 409 when Day exists but has not been staff-committed", async () => {
    dayShiftRow.mockResolvedValue({ isShiftCommitted: false, hasEntries: true });

    const res = await fetch(`${baseUrl}/shift-commit`, { method: "POST" });

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.waitingOnDayShift).toBe(true);
  });
});
