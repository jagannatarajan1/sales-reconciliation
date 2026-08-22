import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTillReport } from "./tillReportParser.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(dir, "__fixtures__", name), "utf-8");

// All bodies below are real till emails read via the live Gmail integration
// (see the doc comments on tillReportParser.ts for why each case matters),
// except z-report-department-named-cash.txt which is a synthetic worst-case
// for the tender-section scoping.

describe("parseTillReport — real Z-Report, header present and consistent", () => {
  const result = parseTillReport(fixture("z-report-2026-08-10.txt"), "Z report");

  it("identifies the report type and ref from the body marker", () => {
    expect(result.reportType).toBe("Z_REPORT");
    expect(result.reportRef).toBe("Z10409");
  });

  it("reads businessDate/printedAt from Date:/Time:, borrowing seconds from the matching header line", () => {
    expect(result.businessDate?.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(result.printedMinutes).toBe(22 * 60 + 22);
    expect(result.printedAt?.toISOString()).toBe("2026-08-10T22:22:25.000Z");
  });

  it("extracts totals", () => {
    expect(result.departmentTotal).toBe(1428.45);
    expect(result.grandTotal).toBe(1425.45);
  });

  it("extracts tender without the MANUAL CARD trap", () => {
    expect(result.tender.cash).toBe(548.07);
    expect(result.tender.card).toBe(639.0);
    expect(result.tender.manualCard).toBe(238.38);
  });

  it("has no parse notes when everything is consistent", () => {
    expect(result.parseError).toBeNull();
  });
});

describe("parseTillReport — real Z-Report, header line entirely absent from the body", () => {
  const result = parseTillReport(fixture("z-report-2026-08-11-no-header.txt"), "Z report");

  it("still resolves businessDate/printedAt from Date:/Time: alone", () => {
    expect(result.reportType).toBe("Z_REPORT");
    expect(result.businessDate?.toISOString()).toBe("2026-08-11T00:00:00.000Z");
    expect(result.printedAt?.toISOString()).toBe("2026-08-11T22:22:00.000Z"); // no header seconds available
  });

  it("does not treat a missing header line as an error", () => {
    expect(result.parseError).toBeNull();
  });

  it("still finds totals and tender", () => {
    expect(result.departmentTotal).toBe(1428.45);
    expect(result.tender.card).toBe(639.0);
  });
});

describe("parseTillReport — real X-Report, header date disagrees with Date: field", () => {
  const result = parseTillReport(fixture("x-report-2026-08-12.txt"), "X-Report Printed");

  it("identifies X_REPORT with no reportRef (X-Reports carry no id)", () => {
    expect(result.reportType).toBe("X_REPORT");
    expect(result.reportRef).toBeNull();
  });

  it("prefers Date:/Time: over the disagreeing header line", () => {
    // Header says "12/08/2026 13:09:00"; the Date: field two lines later
    // says "13/08/2026". businessDate must be the Date: field's 13th.
    expect(result.businessDate?.toISOString()).toBe("2026-08-13T00:00:00.000Z");
    expect(result.printedMinutes).toBe(13 * 60 + 9);
    // Date mismatch means header seconds are not borrowed — defaults to :00.
    expect(result.printedAt?.toISOString()).toBe("2026-08-13T13:09:00.000Z");
  });

  it("surfaces the mismatch as a visible, non-fatal note", () => {
    expect(result.parseError).toContain("header line date (12/08/2026) differs from Date: field (13/08/2026)");
  });

  it("still extracts every total correctly despite the mismatch", () => {
    expect(result.departmentTotal).toBe(355.61);
    expect(result.grandTotal).toBe(352.61);
    expect(result.tender.cash).toBe(165.34);
    expect(result.tender.card).toBe(123.09);
    expect(result.tender.manualCard).toBe(64.18);
  });

  it("ignores the body's own literal 'Subject - X-Report Printed' preamble line", () => {
    // That line does not match the strict report-type marker pattern, so it
    // must not be confused with the real "X-REPORT" marker further down.
    expect(result.reportType).toBe("X_REPORT");
  });
});

describe("parseTillReport — a department named CASH must never leak into the tender total", () => {
  const result = parseTillReport(fixture("z-report-department-named-cash.txt"));

  it("reads the TENDER TYPE section's CASH, not the DEPARTMENT SALES section's", () => {
    expect(result.tender.cash).toBe(30.0); // NOT 40.00, the department line
    expect(result.tender.card).toBe(10.0); // NOT 5.00, the department line
    expect(result.tender.manualCard).toBe(5.0);
  });

  it("still gets the right department/grand totals", () => {
    expect(result.departmentTotal).toBe(45.0);
    expect(result.grandTotal).toBe(45.0);
  });
});

describe("parseTillReport — subject vs body disagreement", () => {
  it("trusts the body marker over a misleading subject", () => {
    const result = parseTillReport(fixture("z-report-2026-08-10.txt"), "X-Report Printed");
    expect(result.reportType).toBe("Z_REPORT"); // body's "Z-REPORT ID:" wins
    expect(result.parseError).toContain("subject suggests X_REPORT but body marker says Z_REPORT");
  });

  it("falls back to a generic subject with no type information gracefully", () => {
    // Real inbox evidence: some historical emails used a bare "REPORT"
    // subject that carries no type signal at all. Body must still resolve
    // the type on its own.
    const result = parseTillReport(fixture("z-report-2026-08-10.txt"), "REPORT");
    expect(result.reportType).toBe("Z_REPORT");
    expect(result.parseError).toBeNull();
  });
});

describe("parseTillReport — empty input", () => {
  it("returns all-null fields with a note, never throws", () => {
    const result = parseTillReport("");
    expect(result.reportType).toBeNull();
    expect(result.businessDate).toBeNull();
    expect(result.departmentTotal).toBeNull();
    expect(result.parseError).not.toBeNull();
  });

  it("returns empty arrays (never null/throw) for every new detailed section", () => {
    const result = parseTillReport("");
    expect(result.departmentLines).toEqual([]);
    expect(result.vatLines).toEqual([]);
    expect(result.transactionCount).toBeNull();
    expect(result.incomeExpenseLines).toEqual([]);
    expect(result.incomeExpenseTotal).toBeNull();
    expect(result.voidLines).toEqual([]);
    expect(result.productLines).toEqual([]);
  });
});

// The X-Report and Z-Report bodies below reproduce the exact section
// layout/spacing of two real till emails from this store (see the fixture
// files' full content) — filled out beyond the excerpt with additional,
// plausibly-formatted department/product lines so every new section has
// something real to extract. This is the first fixture pair exercising ALL
// of the sections added in this phase in one report.
describe("parseTillReport — full real-format X-Report, all detailed sections", () => {
  const result = parseTillReport(fixture("x-report-2026-08-14-full.txt"), "X-Report Printed");

  it("still gets the basics right", () => {
    expect(result.reportType).toBe("X_REPORT");
    expect(result.departmentTotal).toBe(1520.08);
    expect(result.grandTotal).toBe(1517.08);
  });

  it("extracts merchandise department lines, distinct from the lottery/paypoint group", () => {
    const merch = result.departmentLines.filter((l) => l.category === "MERCHANDISE");
    const lottery = result.departmentLines.filter((l) => l.category === "LOTTERY_GROUP");

    expect(merch.find((l) => l.departmentName === "ALCOHOL")).toEqual({
      departmentName: "ALCOHOL",
      amount: 305.05,
      category: "MERCHANDISE",
    });
    expect(merch.find((l) => l.departmentName === "TOBACCO")?.amount).toBe(425.48);
    // Names with internal punctuation must survive intact.
    expect(merch.find((l) => l.departmentName === "GROCERY N.VAT")?.amount).toBe(12.4);
    expect(merch.find((l) => l.departmentName === "HEALTH & BEAUTY")?.amount).toBe(3.15);
    expect(merch.find((l) => l.departmentName === "NEWS&MAG")?.amount).toBe(3.6);
    // Merchandise never leaks lottery/paypoint lines...
    expect(merch.find((l) => l.departmentName === "PAYPOINT")).toBeUndefined();

    expect(lottery).toEqual([
      { departmentName: "INSTANT LOTTERY", amount: 7.0, category: "LOTTERY_GROUP" },
      { departmentName: "LOTTERY", amount: 43.0, category: "LOTTERY_GROUP" },
      { departmentName: "PAYPOINT", amount: 350.0, category: "LOTTERY_GROUP" },
    ]);
  });

  it("extracts VAT breakdown lines, preserving 'Exmt' as text rather than coercing to a number", () => {
    expect(result.vatLines).toEqual([
      { vatCode: "0.00", salesExVat: 151.37, vat: 0.0, salesInVat: 151.37 },
      { vatCode: "20.00", salesExVat: 807.26, vat: 161.45, salesInVat: 968.71 },
      { vatCode: "Exmt", salesExVat: 400.0, vat: 0.0, salesInVat: 400.0 },
    ]);
  });

  it("extracts the transaction count", () => {
    expect(result.transactionCount).toBe(156);
  });

  it("extracts income/expense lines and their printed total", () => {
    expect(result.incomeExpenseLines).toEqual([{ label: "LOTTERY PO", amount: -3.0 }]);
    expect(result.incomeExpenseTotal).toBe(-3.0);
  });

  it("extracts refund/void lines, preserving the full type text verbatim", () => {
    expect(result.voidLines).toHaveLength(3);
    expect(result.voidLines[0].type).toBe("Drawer - 01");
    expect(result.voidLines[0].amount).toBe(0.0);
    expect(result.voidLines[1]).toMatchObject({ type: "Voided - 01", amount: 1.99 });
    expect(result.voidLines[2]).toMatchObject({ type: "Voided - 02", amount: 0.89 });
    // The line's own date/time, not businessDate/printedAt.
    expect(result.voidLines[1].occurredAt.toISOString()).toBe("2026-08-12T11:43:00.000Z");
  });

  it("extracts product lines grouped under their department header, including an N/A stock case", () => {
    const heineken = result.productLines.find((p) => p.productName === "HEINEKEN LGE 650ML");
    expect(heineken).toMatchObject({
      departmentName: "ALCOHOL",
      salesQuantity: 7,
      stockValue: null,
      stockUnavailable: true,
    });

    const bakeryProduct = result.productLines.find((p) => p.departmentName === "BAKERY");
    expect(bakeryProduct).toMatchObject({
      productName: "HOVIS SOFT WHITE MEDIUM 800G",
      salesQuantity: 4,
      stockValue: null,
      stockUnavailable: true,
    });
  });

  it("extracts a negative-stock product line without coercing it", () => {
    const bier = result.productLines.find((p) => p.productName === "1664 BIERE");
    expect(bier).toMatchObject({ departmentName: "ALCOHOL", salesQuantity: 1, stockValue: -6, stockUnavailable: false });
  });

  it("stores a mangled/encoding-artifact product name verbatim, unmodified", () => {
    const mangled = result.productLines.find((p) => p.departmentName === "CHILLED FOODS");
    expect(mangled?.productName).toBe("PM-Ú1.25 SEMI SKIMMED MILK");
    expect(mangled).toMatchObject({ salesQuantity: 3, stockValue: 12, stockUnavailable: false });
  });
});

describe("parseTillReport — full real-format Z-Report, all detailed sections", () => {
  const result = parseTillReport(fixture("z-report-2026-08-14-full.txt"), "Z report");

  it("identifies Z_REPORT with the printed ref", () => {
    expect(result.reportType).toBe("Z_REPORT");
    expect(result.reportRef).toBe("Z10411");
  });

  it("extracts the transaction count and income/expense total", () => {
    expect(result.transactionCount).toBe(289);
    expect(result.incomeExpenseTotal).toBe(-3.0);
  });

  it("extracts three void lines with their own embedded date/time", () => {
    expect(result.voidLines).toHaveLength(3);
    expect(result.voidLines.map((v) => v.type)).toEqual(["Drawer - 01", "Voided - 01", "Voided - 02"]);
  });

  it("extracts department lines split into merchandise vs lottery/paypoint group", () => {
    expect(result.departmentLines.filter((l) => l.category === "MERCHANDISE")).toHaveLength(18);
    expect(result.departmentLines.filter((l) => l.category === "LOTTERY_GROUP")).toHaveLength(3);
  });

  it("has no parse notes — every detailed section is present and well-formed", () => {
    expect(result.parseError).toBeNull();
  });
});

describe("parseTillReport — a department named CASH: department lines vs tender must stay independent", () => {
  const result = parseTillReport(fixture("z-report-department-named-cash.txt"));

  it("reads the department-line CASH/CARD as MERCHANDISE department lines, not tender", () => {
    expect(result.departmentLines).toEqual([
      { departmentName: "CASH", amount: 40.0, category: "MERCHANDISE" },
      { departmentName: "CARD", amount: 5.0, category: "MERCHANDISE" },
    ]);
  });

  it("does not confuse the missing SUB TOTAL with a hard failure", () => {
    expect(result.parseError).toContain("no SUB TOTAL found in DEPARTMENT SALES section");
  });
});
