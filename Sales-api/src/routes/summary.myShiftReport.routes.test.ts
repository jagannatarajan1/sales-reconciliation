import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";
import { Shift, TillReportType } from "@prisma/client";

// End-to-end coverage of GET /Summary/my-shift-report: real Express app,
// real summaryRouter, only prisma mocked (same shape as
// adminReconciliation.forceUnlockNight.routes.test.ts / summary.
// shiftCommit.routes.test.ts). The point of this test is the security
// property, not the DTO shape (already covered by staffTillReportView.
// test.ts): a NIGHT session must never be able to pull DAY data or
// Z-Report data by supplying a query string, because the route reads
// neither — date/shift come only from getActiveContext(), which itself
// reads only the mocked ActiveDateOverride row, never req.query/req.body.

const DATE_STR = "2026-08-21";
const ACTIVE_DATE = new Date(`${DATE_STR}T00:00:00.000Z`);

const activeDateOverride = {
  findUnique: vi.fn(async () => ({
    id: 1,
    activeDate: ACTIVE_DATE,
    activeShift: Shift.NIGHT,
  })),
};

const nightReportRow = {
  tillReportId: 501,
  printedAt: new Date("2026-08-21T22:10:00.000Z"),
  printedMinutes: 22 * 60 + 10,
  cashTotal: 200,
  cardTotal: 75,
  manualCardTotal: 0,
  grandTotal: 275,
  transactionCount: 40,
  incomeExpenseTotal: 0,
  departmentLines: [{ departmentName: "Grocery (Night)", amount: 275, category: "MERCHANDISE" }],
  vatLines: [{ vatCode: "20.00", salesExVat: 229.17, vat: 45.83, salesInVat: 275 }],
  voidLines: [],
  productLines: [],
};

const findManyTillReport = vi.fn();

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    activeDateOverride,
    tillReport: { findMany: (...a: unknown[]) => findManyTillReport(...a) },
  },
}));

const { summaryRouter } = await import("./summary.routes.js");

let server: ReturnType<express.Express["listen"]>;
let baseUrl: string;

beforeAll(() => {
  // getActiveContext() only honors ActiveDateOverride.activeShift while this
  // is on — otherwise every session reads as the legacy FULL_DAY bucket
  // regardless of the mocked override row, same setup as
  // summary.shiftCommit.routes.test.ts.
  process.env.SHIFT_ENTRY_ENABLED = "true";
});

afterAll(() => {
  delete process.env.SHIFT_ENTRY_ENABLED;
});

beforeEach(async () => {
  activeDateOverride.findUnique.mockClear();
  findManyTillReport.mockClear();
  findManyTillReport.mockResolvedValue([nightReportRow]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 9;
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

describe("GET /Summary/my-shift-report", () => {
  it("returns the session's own (NIGHT) report, ignoring a client-supplied shift/date query string", async () => {
    // The session is mocked as NIGHT via activeDateOverride. A malicious or
    // buggy client tries to ask for DAY on a different date via the query
    // string — the route has no query params at all, so this must have zero
    // effect on what comes back.
    const res = await fetch(`${baseUrl}/my-shift-report?shift=DAY&date=2099-01-01`, {
      headers: {},
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // The response reflects the SERVER session's shift (NIGHT), never the
    // DAY the query string asked for.
    expect(body.shift).toBe(Shift.NIGHT);
    expect(body.date).toBeTruthy();

    expect(body.available).toBe(true);
    expect(body.hasReport).toBe(true);
    expect((body.departments as unknown[])[0]).toMatchObject({ name: "Grocery (Night)" });

    // The Prisma call itself was scoped to NIGHT, never DAY — proving the
    // query string had no effect on the actual database query, not merely
    // on the response body.
    expect(findManyTillReport).toHaveBeenCalledTimes(1);
    const call = findManyTillReport.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where.shift).toBe(Shift.NIGHT);
    expect(call.where.shift).not.toBe(Shift.DAY);
  });

  it("never queries Z_REPORT — Z-Report data is structurally unreachable through this route", async () => {
    await fetch(`${baseUrl}/my-shift-report`);

    expect(findManyTillReport).toHaveBeenCalledTimes(1);
    for (const call of findManyTillReport.mock.calls) {
      const where = (call[0] as { where: Record<string, unknown> }).where;
      expect(where.reportType).toBe(TillReportType.X_REPORT);
      expect(where.reportType).not.toBe(TillReportType.Z_REPORT);
    }
  });

  it("rejects unauthenticated requests", async () => {
    // Build a second app with no req.userId set, mirroring how every other
    // Summary route enforces auth.
    const app = express();
    app.use("/api/Summary", summaryRouter);
    const unauthServer = app.listen(0);
    await new Promise<void>((resolve) => unauthServer.once("listening", resolve));
    const { port } = unauthServer.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/api/Summary/my-shift-report`);
    expect(res.status).toBe(401);

    await new Promise((resolve) => unauthServer.close(resolve));
  });
});
