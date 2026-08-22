import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shift, TillReportType } from "@prisma/client";

// getStaffOwnShiftReport is the staff-facing "see my own shift's full till
// report" read model backing GET /Summary/my-shift-report. Same mocking
// shape as entryLock.test.ts: only prisma.tillReport.findMany is a test
// double — aggregateShift/toRawReport/CHILD_INCLUDE (imported from the real
// tillReportReconciliation.js) run for real, so reprint-summing is proven
// against the actual production logic, not a re-implementation of it.
const findManyTillReport = vi.fn();

vi.mock("./prisma.js", () => ({
  prisma: {
    tillReport: { findMany: (...a: unknown[]) => findManyTillReport(...a) },
  },
}));

const { getStaffOwnShiftReport } = await import("./staffTillReportView.js");

const DATE = new Date("2026-08-21T00:00:00.000Z");

function tillReportRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tillReportId: 1,
    printedAt: new Date("2026-08-21T13:05:00.000Z"),
    printedMinutes: 13 * 60 + 5,
    cashTotal: 100.5,
    cardTotal: 50.25,
    manualCardTotal: 10,
    grandTotal: 160.75,
    transactionCount: 24,
    incomeExpenseTotal: -3,
    departmentLines: [
      { departmentName: "Grocery", amount: 80, category: "MERCHANDISE" },
      { departmentName: "Lottery", amount: 20.75, category: "LOTTERY_GROUP" },
    ],
    vatLines: [{ vatCode: "20.00", salesExVat: 66.67, vat: 13.33, salesInVat: 80 }],
    voidLines: [{ type: "Voided - 01", occurredAt: new Date("2026-08-21T13:00:00.000Z"), amount: 1.99 }],
    productLines: [{ departmentName: "Grocery", productName: "Bread", salesQuantity: 5 }],
    ...overrides,
  };
}

beforeEach(() => {
  findManyTillReport.mockReset();
});

describe("getStaffOwnShiftReport — FULL_DAY", () => {
  it("is unavailable for FULL_DAY without querying", async () => {
    const result = await getStaffOwnShiftReport(DATE, Shift.FULL_DAY);
    expect(result).toMatchObject({ available: false });
    expect(findManyTillReport).not.toHaveBeenCalled();
  });
});

describe("getStaffOwnShiftReport — no report yet", () => {
  it("returns hasReport: false when no X-Report rows exist for this shift", async () => {
    findManyTillReport.mockResolvedValue([]);
    const result = await getStaffOwnShiftReport(DATE, Shift.DAY);
    expect(result).toMatchObject({ available: true, hasReport: false });
    if (result.available && !result.hasReport) {
      expect(result.message).toMatch(/no till report/i);
    }
  });

  // The query itself must only ever ask for X_REPORT at the exact
  // (businessDate, shift) it was given — this is the structural half of the
  // "staff can never see Z-Report data" guarantee (the other half is proven
  // by the route test's assertion against the mock's captured `where`
  // clauses).
  it("queries only X_REPORT for the exact (date, shift) given", async () => {
    findManyTillReport.mockResolvedValue([]);
    await getStaffOwnShiftReport(DATE, Shift.NIGHT);

    expect(findManyTillReport).toHaveBeenCalledTimes(1);
    const call = findManyTillReport.mock.calls[0][0];
    expect(call.where.reportType).toBe(TillReportType.X_REPORT);
    expect(call.where.shift).toBe(Shift.NIGHT);
    expect(call.where.businessDate).toEqual(DATE);
  });
});

describe("getStaffOwnShiftReport — a single report", () => {
  it("maps every field through correctly", async () => {
    findManyTillReport.mockResolvedValue([tillReportRow()]);

    const result = await getStaffOwnShiftReport(DATE, Shift.DAY);

    expect(result.available).toBe(true);
    if (!result.available || !result.hasReport) throw new Error("expected hasReport: true");

    expect(result.reportCount).toBe(1);

    expect(result.departments).toEqual(
      expect.arrayContaining([
        { name: "Grocery", amount: 80, category: "MERCHANDISE" },
        { name: "Lottery", amount: 20.75, category: "LOTTERY_GROUP" },
      ])
    );
    expect(result.departments).toHaveLength(2);

    expect(result.vat).toEqual([{ code: "20.00", salesExVat: 66.67, vat: 13.33, salesInVat: 80 }]);

    expect(result.totals).toEqual({
      cash: 100.5,
      card: 50.25,
      manualCard: 10,
      grandTotal: 160.75,
      transactionCount: 24,
      incomeExpenseTotal: -3,
    });

    expect(result.voids).toEqual([
      { type: "Voided - 01", occurredAt: "2026-08-21T13:00:00.000Z", amount: 1.99 },
    ]);

    expect(result.products).toEqual([{ departmentName: "Grocery", productName: "Bread", salesQuantity: 5 }]);

    // Safety property: no s1/s2/expected/actual/variance/status/comparison
    // field anywhere in the DTO — this is a report's own contents, not a
    // comparison against anything else.
    const serialized = JSON.stringify(result);
    for (const forbidden of ["s1", "s2", "expected", "variance", "\"status\""]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("getStaffOwnShiftReport — reprint summing (two reports for the same shift)", () => {
  it("sums department/VAT/tender/product totals via the real aggregateShift, and unions void lines", async () => {
    const first = tillReportRow({ tillReportId: 1 });
    const second = tillReportRow({
      tillReportId: 2,
      printedAt: new Date("2026-08-21T13:10:00.000Z"),
      printedMinutes: 13 * 60 + 10,
      cashTotal: 25,
      cardTotal: 5,
      manualCardTotal: 0,
      grandTotal: 30,
      transactionCount: 6,
      incomeExpenseTotal: 0,
      departmentLines: [{ departmentName: "Grocery", amount: 15, category: "MERCHANDISE" }],
      vatLines: [{ vatCode: "20.00", salesExVat: 12.5, vat: 2.5, salesInVat: 15 }],
      voidLines: [{ type: "Voided - 01", occurredAt: new Date("2026-08-21T13:08:00.000Z"), amount: 2.5 }],
      productLines: [{ departmentName: "Grocery", productName: "Bread", salesQuantity: 2 }],
    });
    findManyTillReport.mockResolvedValue([first, second]);

    const result = await getStaffOwnShiftReport(DATE, Shift.DAY);

    expect(result.available).toBe(true);
    if (!result.available || !result.hasReport) throw new Error("expected hasReport: true");

    expect(result.reportCount).toBe(2);

    // Grocery: 80 (first report) + 15 (second report) = 95 — the concrete
    // summed department amount proving reprint-summing actually ran, not
    // just "didn't crash".
    const grocery = result.departments.find((d) => d.name === "Grocery");
    expect(grocery?.amount).toBe(95);

    // Lottery only appeared on the first report — untouched by the second.
    const lottery = result.departments.find((d) => d.name === "Lottery");
    expect(lottery?.amount).toBe(20.75);

    // VAT: salesExVat 66.67+12.5=79.17, vat 13.33+2.5=15.83, salesInVat 80+15=95
    expect(result.vat).toEqual([{ code: "20.00", salesExVat: 79.17, vat: 15.83, salesInVat: 95 }]);

    // Tender totals summed across both reports.
    expect(result.totals).toEqual({
      cash: 125.5,
      card: 55.25,
      manualCard: 10,
      grandTotal: 190.75,
      transactionCount: 30,
      incomeExpenseTotal: -3,
    });

    // Products: Bread 5 + 2 = 7.
    expect(result.products).toEqual([{ departmentName: "Grocery", productName: "Bread", salesQuantity: 7 }]);

    // Voids are discrete events, unioned (not summed) — both occurrences
    // appear, sorted by time.
    expect(result.voids).toEqual([
      { type: "Voided - 01", occurredAt: "2026-08-21T13:00:00.000Z", amount: 1.99 },
      { type: "Voided - 01", occurredAt: "2026-08-21T13:08:00.000Z", amount: 2.5 },
    ]);
  });
});
