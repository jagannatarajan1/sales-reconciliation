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
});
