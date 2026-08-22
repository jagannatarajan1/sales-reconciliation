import { describe, expect, it } from "vitest";
import { reconcileDayFromReports, type RawTillReportRecord, type ReconcileDayInput } from "./tillReportReconciliation.js";

// reconcileDayFromReports is pure (no Prisma, no I/O) — every test below
// constructs plain input objects directly, per the spec's guidance to keep
// the comparison engine testable independent of the DB-fetching wrapper
// (reconcileDay, which just loads TillReport rows and calls this).

let nextId = 1;

function report(overrides: Partial<RawTillReportRecord> = {}): RawTillReportRecord {
  return {
    tillReportId: nextId++,
    printedAt: new Date("2026-08-14T13:00:00.000Z"),
    printedMinutes: 13 * 60,
    cashTotal: null,
    cardTotal: null,
    manualCardTotal: null,
    grandTotal: null,
    transactionCount: null,
    incomeExpenseTotal: null,
    departmentLines: [],
    vatLines: [],
    voidLines: [],
    productLines: [],
    ...overrides,
  };
}

const BUSINESS_DATE = new Date("2026-08-14T00:00:00.000Z");

describe("reconcileDayFromReports — missing report days", () => {
  it("reports WAITING_FOR_Z when Day X and Night X exist but Z hasn't arrived yet", () => {
    const input: ReconcileDayInput = {
      businessDate: BUSINESS_DATE,
      dayXReports: [report()],
      nightXReports: [report()],
      zReport: null,
      zReportCount: 0,
    };
    const result = reconcileDayFromReports(input);

    expect(result.overallStatus).toBe("WAITING_FOR_Z");
    expect(result.waitingFor).toEqual(["Z"]);
    expect(result.reportPresence.z.present).toBe(false);
    // No misleading PASS/FAIL against absent data.
    expect(result.categories.department.status).toBe("NOT_APPLICABLE");
    expect(result.categories.tender.status).toBe("NOT_APPLICABLE");
    expect(result.categories.void.status).toBe("NOT_APPLICABLE");
  });

  it("reports WAITING_FOR_REPORTS (not a single specific one) when more than one is missing", () => {
    const input: ReconcileDayInput = {
      businessDate: BUSINESS_DATE,
      dayXReports: [],
      nightXReports: [],
      zReport: report(),
      zReportCount: 1,
    };
    const result = reconcileDayFromReports(input);

    expect(result.overallStatus).toBe("WAITING_FOR_REPORTS");
    expect(result.waitingFor).toEqual(["DAY_X", "NIGHT_X"]);
  });

  it("reports WAITING_FOR_DAY_X when only the day shift is missing", () => {
    const input: ReconcileDayInput = {
      businessDate: BUSINESS_DATE,
      dayXReports: [],
      nightXReports: [report()],
      zReport: report(),
      zReportCount: 1,
    };
    const result = reconcileDayFromReports(input);
    expect(result.overallStatus).toBe("WAITING_FOR_DAY_X");
    expect(result.waitingFor).toEqual(["DAY_X"]);
  });
});

describe("reconcileDayFromReports — department reconciliation", () => {
  it("PASS: S1 + S2 sums exactly to Z, straightforward clean case", () => {
    const s1 = report({
      departmentLines: [
        { departmentName: "ALCOHOL", amount: 150.0, category: "MERCHANDISE" },
        { departmentName: "PAYPOINT", amount: 200.0, category: "LOTTERY_GROUP" },
      ],
    });
    const s2 = report({
      departmentLines: [
        { departmentName: "ALCOHOL", amount: 155.05, category: "MERCHANDISE" },
        { departmentName: "PAYPOINT", amount: 150.0, category: "LOTTERY_GROUP" },
      ],
    });
    const z = report({
      departmentLines: [
        { departmentName: "ALCOHOL", amount: 305.05, category: "MERCHANDISE" },
        { departmentName: "PAYPOINT", amount: 350.0, category: "LOTTERY_GROUP" },
      ],
    });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.categories.department.status).toBe("PASS");
    const alcohol = result.categories.department.lines.find((l) => l.key === "ALCOHOL");
    expect(alcohol).toMatchObject({ s1: 150.0, s2: 155.05, expected: 305.05, actual: 305.05, variance: 0, status: "PASS" });
    // Category stays distinguishable in the output.
    const paypoint = result.categories.department.lines.find((l) => l.key === "PAYPOINT");
    expect(paypoint?.category).toBe("LOTTERY_GROUP");
    // No other category was populated in this fixture (tender/VAT/etc are
    // all still null on these bare report() defaults), so only assert this
    // category is clean — the full-day RECONCILED case is covered below.
    expect(result.exceptions.filter((e) => e.category === "DEPARTMENT")).toHaveLength(0);
  });

  it("FAIL: a deliberate mismatch between the sum and Z is caught exactly (no tolerance)", () => {
    const s1 = report({ departmentLines: [{ departmentName: "TOBACCO", amount: 200.0, category: "MERCHANDISE" }] });
    const s2 = report({ departmentLines: [{ departmentName: "TOBACCO", amount: 225.48, category: "MERCHANDISE" }] });
    // Z is off by a single penny — must still FAIL, unlike the £5-tolerance
    // till-vs-staff check elsewhere in the app.
    const z = report({ departmentLines: [{ departmentName: "TOBACCO", amount: 425.49, category: "MERCHANDISE" }] });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    const tobacco = result.categories.department.lines.find((l) => l.key === "TOBACCO");
    expect(tobacco).toMatchObject({ expected: 425.48, actual: 425.49, variance: 0.01, status: "FAIL" });
    expect(result.categories.department.status).toBe("FAIL");
    expect(result.overallStatus).toBe("EXCEPTION");
    expect(result.exceptions.some((e) => e.category === "DEPARTMENT" && e.key.includes("TOBACCO"))).toBe(true);
  });

  it("legitimate PASS: a department appearing in only ONE shift is normal, not flagged", () => {
    const s1 = report({ departmentLines: [{ departmentName: "ICE CREAM", amount: 9.9, category: "MERCHANDISE" }] });
    const s2 = report({ departmentLines: [] }); // ICE CREAM simply wasn't sold on nights
    const z = report({ departmentLines: [{ departmentName: "ICE CREAM", amount: 9.9, category: "MERCHANDISE" }] });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    const iceCream = result.categories.department.lines.find((l) => l.key === "ICE CREAM");
    expect(iceCream).toMatchObject({ s1: 9.9, s2: null, expected: 9.9, actual: 9.9, status: "PASS" });
  });

  it("DATA_MISSING: a department appearing ONLY in Z (neither shift) is flagged, not auto-zeroed", () => {
    const s1 = report({ departmentLines: [] });
    const s2 = report({ departmentLines: [] });
    const z = report({ departmentLines: [{ departmentName: "MISC", amount: 4.2, category: "MERCHANDISE" }] });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    const misc = result.categories.department.lines.find((l) => l.key === "MISC");
    expect(misc?.status).toBe("DATA_MISSING");
    expect(misc?.expected).toBeNull(); // never an automatic zero
    expect(misc?.actual).toBe(4.2);
    expect(result.overallStatus).toBe("EXCEPTION");
  });

  it("sums reprints (two X-Reports in one shift) before comparing, same additive philosophy as getShiftXTotal", () => {
    const s1a = report({ departmentLines: [{ departmentName: "BAKERY", amount: 5.0, category: "MERCHANDISE" }] });
    const s1b = report({ departmentLines: [{ departmentName: "BAKERY", amount: 6.34, category: "MERCHANDISE" }] });
    const s2 = report({ departmentLines: [] });
    const z = report({ departmentLines: [{ departmentName: "BAKERY", amount: 11.34, category: "MERCHANDISE" }] });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1a, s1b],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.reportPresence.dayX.count).toBe(2);
    const bakery = result.categories.department.lines.find((l) => l.key === "BAKERY");
    expect(bakery).toMatchObject({ s1: 11.34, s2: null, expected: 11.34, actual: 11.34, status: "PASS" });
  });
});

describe("reconcileDayFromReports — VAT reconciliation", () => {
  it("PASS when all three fields reconcile per code, 'Exmt' handled as an ordinary code", () => {
    const s1 = report({ vatLines: [{ vatCode: "Exmt", salesExVat: 200.0, vat: 0, salesInVat: 200.0 }] });
    const s2 = report({ vatLines: [{ vatCode: "Exmt", salesExVat: 200.0, vat: 0, salesInVat: 200.0 }] });
    const z = report({ vatLines: [{ vatCode: "Exmt", salesExVat: 400.0, vat: 0, salesInVat: 400.0 }] });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    const exmt = result.categories.vat.lines.find((l) => l.vatCode === "Exmt");
    expect(exmt?.status).toBe("PASS");
    expect(exmt?.salesExVat).toMatchObject({ expected: 400, actual: 400, variance: 0 });
  });

  it("FAIL on a single mismatched field within an otherwise-matching VAT code", () => {
    const s1 = report({ vatLines: [{ vatCode: "20.00", salesExVat: 400.0, vat: 80.0, salesInVat: 480.0 }] });
    const s2 = report({ vatLines: [{ vatCode: "20.00", salesExVat: 407.26, vat: 81.45, salesInVat: 488.71 }] });
    const z = report({ vatLines: [{ vatCode: "20.00", salesExVat: 807.26, vat: 999.99, salesInVat: 968.71 }] });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    const line = result.categories.vat.lines.find((l) => l.vatCode === "20.00")!;
    expect(line.salesExVat.status).toBe("PASS");
    expect(line.vat.status).toBe("FAIL");
    expect(line.salesInVat.status).toBe("PASS");
    expect(line.status).toBe("FAIL"); // worst-of rolls up
  });
});

describe("reconcileDayFromReports — tender (cash/card/manualCard/grandTotal)", () => {
  it("wires up cashTotal/cardTotal/manualCardTotal/grandTotal into a real exact-match comparison", () => {
    const s1 = report({ cashTotal: 300.0, cardTotal: 300.0, manualCardTotal: 130.0, grandTotal: 730.0 });
    const s2 = report({ cashTotal: 330.51, cardTotal: 310.13, manualCardTotal: 146.44, grandTotal: 787.08 });
    const z = report({ cashTotal: 630.51, cardTotal: 610.13, manualCardTotal: 276.44, grandTotal: 1517.08 });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.categories.tender.status).toBe("PASS");
    expect(result.categories.tender.cash).toMatchObject({ expected: 630.51, actual: 630.51, variance: 0, status: "PASS" });
    expect(result.categories.tender.grandTotal).toMatchObject({ expected: 1517.08, actual: 1517.08, status: "PASS" });
  });

  it("FAILs exactly on a tender mismatch, no £5 tolerance applied", () => {
    const s1 = report({ cashTotal: 300.0, cardTotal: 300, manualCardTotal: 130, grandTotal: 730 });
    const s2 = report({ cashTotal: 300.0, cardTotal: 310.13, manualCardTotal: 146.44, grandTotal: 787.08 });
    // Off by 30, well under the £5 tolerance used elsewhere but must still fail here.
    const z = report({ cashTotal: 630.0, cardTotal: 610.13, manualCardTotal: 276.44, grandTotal: 1517.08 });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.categories.tender.cash).toMatchObject({ status: "FAIL", variance: 30 });
    expect(result.categories.tender.status).toBe("FAIL");
    expect(result.overallStatus).toBe("EXCEPTION");
  });
});

describe("reconcileDayFromReports — transaction count / income-expense", () => {
  it("PASS when counts/totals sum exactly", () => {
    const s1 = report({ transactionCount: 100, incomeExpenseTotal: -1.5 });
    const s2 = report({ transactionCount: 189, incomeExpenseTotal: -1.5 });
    const z = report({ transactionCount: 289, incomeExpenseTotal: -3.0 });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.categories.transactionCount).toMatchObject({ expected: 289, actual: 289, status: "PASS" });
    expect(result.categories.incomeExpense).toMatchObject({ expected: -3.0, actual: -3.0, status: "PASS" });
  });

  it("DATA_MISSING (not a guessed 0) when the field failed to parse on any of the three reports", () => {
    const s1 = report({ transactionCount: null }); // failed to parse
    const s2 = report({ transactionCount: 189 });
    const z = report({ transactionCount: 289 });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.categories.transactionCount.status).toBe("DATA_MISSING");
    expect(result.categories.transactionCount.expected).toBeNull();
    expect(result.overallStatus).toBe("EXCEPTION");
  });
});

describe("reconcileDayFromReports — void/refund reconciliation", () => {
  const T = (h: number, m: number) => new Date(Date.UTC(2026, 7, 14, h, m, 0));

  it("PASS when every Z void line is matched by a shift void line 1:1", () => {
    const s1 = report({ voidLines: [{ type: "Drawer - 01", occurredAt: T(10, 23), amount: 0.0 }] });
    const s2 = report({ voidLines: [{ type: "Voided - 01", occurredAt: T(21, 43), amount: 1.99 }] });
    const z = report({
      voidLines: [
        { type: "Drawer - 01", occurredAt: T(10, 23), amount: 0.0 },
        { type: "Voided - 01", occurredAt: T(21, 43), amount: 1.99 },
      ],
    });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.categories.void.status).toBe("PASS");
    expect(result.categories.void.summary).toEqual({ totalMissing: 0, totalUnexpected: 0, totalDuplicate: 0 });
  });

  it("flags a MISSING void: present on a shift X-Report but never carried through to Z", () => {
    const s1 = report({ voidLines: [{ type: "Voided - 02", occurredAt: T(12, 52), amount: 0.89 }] });
    const s2 = report({ voidLines: [] });
    const z = report({ voidLines: [] }); // dropped

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.categories.void.summary.totalMissing).toBe(1);
    expect(result.categories.void.summary.totalUnexpected).toBe(0);
    expect(result.categories.void.summary.totalDuplicate).toBe(0);
    const tuple = result.categories.void.tuples.find((t) => t.type === "Voided - 02");
    expect(tuple).toMatchObject({ expectedCount: 1, actualCount: 0, missingCount: 1, status: "FAIL" });
  });

  it("flags an UNEXPECTED void: appears in Z with zero basis in either shift", () => {
    const s1 = report({ voidLines: [] });
    const s2 = report({ voidLines: [] });
    const z = report({ voidLines: [{ type: "Voided - 03", occurredAt: T(14, 0), amount: 5.0 }] });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.categories.void.summary.totalUnexpected).toBe(1);
    const tuple = result.categories.void.tuples.find((t) => t.type === "Voided - 03");
    expect(tuple).toMatchObject({ expectedCount: 0, actualCount: 1, unexpectedCount: 1, missingCount: 0, duplicateCount: 0 });
  });

  it("flags a DUPLICATE: same tuple appears MORE times in Z than S1+S2 combined justify", () => {
    const s1 = report({ voidLines: [{ type: "Voided - 01", occurredAt: T(11, 43), amount: 1.99 }] });
    const s2 = report({ voidLines: [] });
    // Z shows the identical tuple twice, but only one shift occurrence backs it.
    const z = report({
      voidLines: [
        { type: "Voided - 01", occurredAt: T(11, 43), amount: 1.99 },
        { type: "Voided - 01", occurredAt: T(11, 43), amount: 1.99 },
      ],
    });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.categories.void.summary.totalDuplicate).toBe(1);
    expect(result.categories.void.summary.totalUnexpected).toBe(0);
    const tuple = result.categories.void.tuples.find((t) => t.type === "Voided - 01");
    expect(tuple).toMatchObject({ expectedCount: 1, actualCount: 2, matchedCount: 1, duplicateCount: 1, missingCount: 0 });
  });

  it("does not just compare counts: a missing and an unexpected void with equal totals is NOT a false PASS", () => {
    // Same total count (1 shift-side, 1 Z-side) but they are DIFFERENT
    // events — comparing bare counts would wrongly say PASS.
    const s1 = report({ voidLines: [{ type: "Voided - 01", occurredAt: T(11, 43), amount: 1.99 }] });
    const s2 = report({ voidLines: [] });
    const z = report({ voidLines: [{ type: "Voided - 02", occurredAt: T(12, 52), amount: 0.89 }] });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.categories.void.status).toBe("FAIL");
    expect(result.categories.void.summary).toEqual({ totalMissing: 1, totalUnexpected: 1, totalDuplicate: 0 });
  });
});

describe("reconcileDayFromReports — product quantity reconciliation", () => {
  it("PASS when quantities sum exactly, matched on verbatim productName", () => {
    const s1 = report({
      productLines: [{ departmentName: "ALCOHOL", productName: "1664 BIERE", salesQuantity: 1 }],
    });
    const s2 = report({
      productLines: [{ departmentName: "ALCOHOL", productName: "1664 BIERE", salesQuantity: 1 }],
    });
    const z = report({
      productLines: [{ departmentName: "ALCOHOL", productName: "1664 BIERE", salesQuantity: 2 }],
    });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    const bier = result.categories.product.lines.find((l) => l.key === "1664 BIERE");
    expect(bier).toMatchObject({ s1: 1, s2: 1, expected: 2, actual: 2, status: "PASS" });
  });

  it("legitimate PASS: a product sold in only ONE shift is normal and expected", () => {
    const s1 = report({
      productLines: [{ departmentName: "BAKERY", productName: "HOVIS SOFT WHITE MEDIUM 800G", salesQuantity: 4 }],
    });
    const s2 = report({ productLines: [] });
    const z = report({
      productLines: [{ departmentName: "BAKERY", productName: "HOVIS SOFT WHITE MEDIUM 800G", salesQuantity: 4 }],
    });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    const hovis = result.categories.product.lines.find((l) => l.key === "HOVIS SOFT WHITE MEDIUM 800G");
    expect(hovis).toMatchObject({ s1: 4, s2: null, expected: 4, actual: 4, status: "PASS" });
  });

  it("DATA_MISSING: a product appearing ONLY in Z (neither shift) is flagged, not silently zeroed", () => {
    const s1 = report({ productLines: [] });
    const s2 = report({ productLines: [] });
    const z = report({
      productLines: [{ departmentName: "CHILLED FOODS", productName: "PM-£1.25 SEMI SKIMMED MILK", salesQuantity: 3 }],
    });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    const milk = result.categories.product.lines.find((l) => l.key === "PM-£1.25 SEMI SKIMMED MILK");
    expect(milk?.status).toBe("DATA_MISSING");
    expect(milk?.expected).toBeNull();
  });

  it("does not merge near-duplicate product names, only warns", () => {
    const s1 = report({
      productLines: [{ departmentName: "ALCOHOL", productName: "HEINEKEN LGE 650ML", salesQuantity: 3 }],
    });
    const s2 = report({
      // Same product, different verbatim spelling/spacing — must stay a separate row.
      productLines: [{ departmentName: "ALCOHOL", productName: "HEINEKEN LGE  650 ML", salesQuantity: 4 }],
    });
    const z = report({
      productLines: [
        { departmentName: "ALCOHOL", productName: "HEINEKEN LGE 650ML", salesQuantity: 3 },
        { departmentName: "ALCOHOL", productName: "HEINEKEN LGE  650 ML", salesQuantity: 4 },
      ],
    });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    // Two distinct rows, neither merged into the other.
    expect(result.categories.product.lines.filter((l) => l.key.startsWith("HEINEKEN"))).toHaveLength(2);
    expect(result.categories.product.lines.find((l) => l.key === "HEINEKEN LGE 650ML")).toMatchObject({
      s1: 3,
      s2: null,
      status: "PASS",
    });
    expect(result.categories.product.nearDuplicateWarnings.length).toBeGreaterThan(0);
    expect(result.categories.product.nearDuplicateWarnings[0]).toContain("HEINEKEN");
  });
});

describe("reconcileDayFromReports — timing validation", () => {
  it("flags a DAY X-Report printed outside its 12:00-15:00 window, but still fully compares it", () => {
    const s1 = report({
      printedAt: new Date("2026-08-14T09:00:00.000Z"),
      printedMinutes: 9 * 60, // way before the window
      departmentLines: [{ departmentName: "ALCOHOL", amount: 10, category: "MERCHANDISE" }],
    });
    const s2 = report({
      printedAt: new Date("2026-08-14T22:00:00.000Z"),
      printedMinutes: 22 * 60,
      departmentLines: [],
    });
    const z = report({
      printedAt: new Date("2026-08-14T22:06:00.000Z"),
      printedMinutes: 22 * 60 + 6,
      departmentLines: [{ departmentName: "ALCOHOL", amount: 10, category: "MERCHANDISE" }],
    });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.timingExceptionCount).toBe(1);
    const dayTiming = result.timing.find((t) => t.role === "DAY_X");
    expect(dayTiming?.withinWindow).toBe(false);
    // Still processed/compared — not skipped or rejected.
    expect(result.categories.department.status).toBe("PASS");
    expect(result.exceptions.some((e) => e.category === "TIMING")).toBe(true);
  });

  it("does not flag a report printed inside its window", () => {
    const s1 = report({ printedAt: new Date("2026-08-14T13:09:00.000Z"), printedMinutes: 13 * 60 + 9 });
    const s2 = report({ printedAt: new Date("2026-08-14T22:06:00.000Z"), printedMinutes: 22 * 60 + 6 });
    const z = report({ printedAt: new Date("2026-08-14T22:06:00.000Z"), printedMinutes: 22 * 60 + 6 });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.timingExceptionCount).toBe(0);
  });
});

describe("reconcileDayFromReports — reprint/duplicate report presence", () => {
  it("surfaces a count > 1 when more than one X-Report existed for a shift", () => {
    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [report(), report()],
      nightXReports: [report()],
      zReport: report(),
      zReportCount: 2, // a Z reprint also existed
    });

    expect(result.reportPresence.dayX.count).toBe(2);
    expect(result.reportPresence.z.count).toBe(2);
    // Only the (single) authoritative Z is used as the comparison basis.
    expect(result.reportPresence.z.reportIds).toHaveLength(1);
  });
});

describe("reconcileDayFromReports — overall roll-up", () => {
  it("RECONCILED only when every category is PASS/NOT_APPLICABLE with all reports present", () => {
    const s1 = report({
      printedAt: new Date("2026-08-14T13:00:00.000Z"),
      printedMinutes: 13 * 60,
      cashTotal: 100,
      cardTotal: 50,
      manualCardTotal: 10,
      grandTotal: 160,
      transactionCount: 10,
      incomeExpenseTotal: 0,
      departmentLines: [{ departmentName: "ALCOHOL", amount: 160, category: "MERCHANDISE" }],
      vatLines: [{ vatCode: "20.00", salesExVat: 133.33, vat: 26.67, salesInVat: 160 }],
      voidLines: [],
      productLines: [{ departmentName: "ALCOHOL", productName: "1664 BIERE", salesQuantity: 1 }],
    });
    const s2 = report({
      printedAt: new Date("2026-08-14T22:06:00.000Z"),
      printedMinutes: 22 * 60 + 6,
      cashTotal: 0,
      cardTotal: 0,
      manualCardTotal: 0,
      grandTotal: 0,
      transactionCount: 0,
      incomeExpenseTotal: 0,
      departmentLines: [],
      vatLines: [],
      voidLines: [],
      productLines: [],
    });
    const z = report({
      printedAt: new Date("2026-08-14T22:06:00.000Z"),
      printedMinutes: 22 * 60 + 6,
      cashTotal: 100,
      cardTotal: 50,
      manualCardTotal: 10,
      grandTotal: 160,
      transactionCount: 10,
      incomeExpenseTotal: 0,
      departmentLines: [{ departmentName: "ALCOHOL", amount: 160, category: "MERCHANDISE" }],
      vatLines: [{ vatCode: "20.00", salesExVat: 133.33, vat: 26.67, salesInVat: 160 }],
      voidLines: [],
      productLines: [{ departmentName: "ALCOHOL", productName: "1664 BIERE", salesQuantity: 1 }],
    });

    const result = reconcileDayFromReports({
      businessDate: BUSINESS_DATE,
      dayXReports: [s1],
      nightXReports: [s2],
      zReport: z,
      zReportCount: 1,
    });

    expect(result.overallStatus).toBe("RECONCILED");
    expect(result.exceptions).toHaveLength(0);
  });
});
