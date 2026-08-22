import { parseLabelledAmount } from "./departmentTotal.js";

export type TillReportType = "X_REPORT" | "Z_REPORT";

export interface TillReportTender {
  cash: number | null;
  card: number | null;
  manualCard: number | null;
}

// Mirrors the schema's TillReportDepartmentCategory enum — kept as a plain
// string union here (rather than importing the Prisma enum) so this module
// has no dependency on the generated client, same as every other type in
// this file.
export type TillReportDepartmentCategory = "MERCHANDISE" | "LOTTERY_GROUP";

export interface TillReportDepartmentLine {
  departmentName: string;
  amount: number;
  category: TillReportDepartmentCategory;
}

export interface TillReportVatLine {
  vatCode: string; // "0.00" | "20.00" | "Exmt" — verbatim, never coerced to a number
  salesExVat: number;
  vat: number;
  salesInVat: number;
}

export interface TillReportIncomeExpenseLine {
  label: string;
  amount: number;
}

export interface TillReportVoidLine {
  type: string; // "Drawer - 01" | "Voided - 03" — verbatim, not split further
  occurredAt: Date;
  amount: number;
}

export interface TillReportProductLine {
  departmentName: string;
  productName: string; // verbatim, including any mangled/encoding-artifact characters
  salesQuantity: number;
  stockValue: number | null; // null means the till printed "N/A" — never coerced to 0
  stockUnavailable: boolean;
}

export interface ParsedTillReport {
  reportType: TillReportType | null;
  // The report's OWN "Date: dd/MM/yyyy" field — NOT the email's received
  // date. These routinely differ (an email received one day can carry the
  // previous day's report), so this is what every date-based lookup must key
  // on instead of the email's internalDate.
  businessDate: Date | null;
  // businessDate + the report's own "Time: HH:mm", i.e. shop-local wall
  // clock as printed on the till slip. This is what shift classification
  // (DAY vs NIGHT against the configured cutoff) must use — it is immune to
  // server timezone and to email delivery lag, unlike the email's received
  // timestamp.
  printedAt: Date | null;
  printedMinutes: number | null;
  reportRef: string | null; // "Z10409" — Z-Reports only, X-Reports carry no ID
  departmentTotal: number | null;
  grandTotal: number | null;
  tender: TillReportTender;
  // Per-department "DEPARTMENT SALES" lines, both the merchandise block and
  // the INSTANT LOTTERY / LOTTERY / PAYPOINT block (see category on each
  // line). Empty array — never null — when the section can't be found or
  // yields no lines; that failure is recorded as a note in parseError
  // instead, matching this file's non-fatal-optional-field philosophy.
  departmentLines: TillReportDepartmentLine[];
  vatLines: TillReportVatLine[];
  // From the "No of Transactions : N" line.
  transactionCount: number | null;
  incomeExpenseLines: TillReportIncomeExpenseLine[];
  // The report's own "Income / Expense TOTAL" figure — the aggregate behind
  // incomeExpenseLines, kept separately since it's printed as its own line.
  incomeExpenseTotal: number | null;
  voidLines: TillReportVoidLine[];
  productLines: TillReportProductLine[];
  // Non-fatal notes about the parse, ';'-joined — may be present even when
  // every field above was successfully extracted (e.g. a header/Date:
  // mismatch, see parseTillReport's doc comment). Meant to be shown to a
  // human via the diagnostic endpoint, not treated as a hard failure signal
  // on its own — check the individual fields for that.
  parseError: string | null;
}

const DATE_FIELD_RE = /\bDate:\s*(\d{2})\/(\d{2})\/(\d{4})/i;
const TIME_FIELD_RE = /\bTime:\s*(\d{2}):(\d{2})/i;

// The free-text header line — "X-Report Printed by VISUAL at 12/08/2026
// 13:09:00" — is NOT anchored to the start of the body. Real emails have
// been seen both with and without a preamble before it (sometimes the
// letterhead/logo block simply isn't present in the plain-text part at
// all), so this searches the whole body rather than requiring position 0.
const HEADER_LINE_RE =
  /(X|Z)-Report Printed by .+? at (\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/i;

// The report-type marker line differs in shape between the two report
// types in real samples: Z-Reports carry an id ("Z-REPORT ID: Z10409"),
// X-Reports don't ("X-REPORT" alone). Both are matched by one pattern with
// the id capture optional.
const REPORT_TYPE_MARKER_RE = /^\s*(X|Z)-REPORT(?:\s+ID:\s*(\S+))?\s*$/im;

// Legacy/loose subject conventions actually observed in this inbox before
// the till was sending the documented "X-Report Printed" / "Z-Report
// Printed" subjects: bare "Z report", and a generic "REPORT" that carries no
// type information at all. Subject is only ever a secondary signal (see
// parseTillReport's doc comment) — this is deliberately forgiving.
const SUBJECT_X_RE = /^\s*X[\s-]*Report(\s+Printed)?\s*$/i;
const SUBJECT_Z_RE = /^\s*Z[\s-]*Report(\s+Printed)?\s*$/i;

const GRAND_TOTAL_RE = /GRAND\s+TOTAL\s+([\d,]+\.\d{2})/i;

const TENDER_TYPE_MARKER = /TENDER\s+TYPE/i;
const DIVIDER_RE = /-{10,}/;

// Anchored to line-start (with the `m` flag) so "CARD 639.00" can never
// accidentally match on the "MANUAL CARD 238.38" line below it — a bare,
// unanchored /CARD\s+.../ search is one till-software line-order change away
// from silently reading someone's manual-card float as their card total.
const CASH_RE = /^[ \t]*CASH[ \t]+([\d,]+\.\d{2})[ \t]*$/im;
const CARD_RE = /^[ \t]*CARD[ \t]+([\d,]+\.\d{2})[ \t]*$/im;
const MANUAL_CARD_RE = /^[ \t]*MANUAL[ \t]+CARD[ \t]+([\d,]+\.\d{2})[ \t]*$/im;

// --- Detailed sections added in phase 1 of the richer-parsing work ---
//
// The real report body (via Gmail's HTML-to-plain-text conversion) has been
// seen in two shapes: every printed line followed by a blank line, and a
// tighter form with no blank lines at all. Neither shape is assumed —
// section boundaries are found by marker/divider text, never by line
// position, and per-line regexes below use the `m` flag so they match once
// per real line regardless of how much blank-line padding surrounds it.

const DEPARTMENT_SALES_MARKER_RE = /DEPARTMENT\s+SALES/i;
const DEPARTMENT_TOTAL_LINE_RE = /^[ \t]*DEPARTMENT\s+TOTAL[ \t]+([\d,]+\.\d{2})[ \t]*$/im;
const SUB_TOTAL_LINE_RE = /^[ \t]*SUB\s+TOTAL[ \t]+([\d,]+\.\d{2})[ \t]*$/gim;
// Department/income-expense names: letters, digits, spaces and the
// punctuation actually seen in real names ("GROCERY N.VAT", "NEWS&MAG",
// "HEALTH & BEAUTY", "CRISPS AND SNACS"). Non-greedy so the trailing
// whitespace+amount is always the LAST such run on the line, not the first.
const LABELLED_LINE_RE = /^[ \t]*([A-Za-z][A-Za-z0-9 &.'/-]*?)[ \t]+(-?[\d,]+\.\d{2})[ \t]*$/gm;

const VAT_BREAKDOWN_MARKER_RE = /VAT\s+BREAKDOWN/i;
const VAT_LINE_RE =
  /^[ \t]*(\d+(?:\.\d+)?|Exmt)[ \t]+([\d,]+\.\d{2})[ \t]+([\d,]+\.\d{2})[ \t]+([\d,]+\.\d{2})[ \t]*$/gim;

const TRANSACTION_COUNT_RE = /No\s+of\s+Transactions[ \t]*:[ \t]*(\d+)/i;

const INCOME_EXPENSE_MARKER_RE = /INCOME\s*\/\s*EXPENSE/i;
const INCOME_EXPENSE_TOTAL_RE = /Income\s*\/\s*Expense\s+TOTAL[ \t]+(-?[\d,]+\.\d{2})/i;
const INCOME_EXPENSE_TOTAL_LABEL_RE = /^Income\s*\/\s*Expense\s+TOTAL$/i;

const REFUNDS_VOIDS_MARKER_RE = /REFUNDS\s*\/\s*VOIDS\s+BREAKDOWN/i;
// Type column is always "Drawer - NN" or "Voided - NN" in every real sample
// seen — captured whole rather than split into a code + number, per the
// spec for this phase.
const VOID_LINE_RE =
  /^[ \t]*((?:Drawer|Voided)[ \t]*-[ \t]*\d+)[ \t]+(\d{2})\/(\d{2})\/(\d{4})[ \t]+(\d{2}):(\d{2}):(\d{2})[ \t]+(-?[\d,]+\.\d{2})[ \t]*$/gim;

const SALES_INVENTORY_MARKER_RE = /SALES\s+AND\s+INVENTORY\s+DETAILS/i;
const PRODUCT_HEADER_ROW_RE = /^DESCRIPTION\b.*STOCK[ \t]*$/i;
// A product row is "<name>  <sales qty>  <stock|N/A>" — a bare department
// header line (e.g. "ALCOHOL") has no trailing numeric columns and simply
// never matches this, which is what tells parseProductLines it's a header
// rather than a product row (see there).
const PRODUCT_LINE_RE = /^(.+?)[ \t]+(-?\d+)[ \t]+(-?\d+|N\/A)$/i;

function parseDateField(body: string): { date: Date; raw: RegExpMatchArray } | null {
  const match = body.match(DATE_FIELD_RE);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (Number.isNaN(date.getTime())) return null;
  return { date, raw: match };
}

function parseTimeField(body: string): { hours: number; minutes: number } | null {
  const match = body.match(TIME_FIELD_RE);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

// Scopes section parsing to the text between `markerRe`'s first match and
// the next divider — never the whole body. Belt-and-braces alongside any
// line-anchoring in the per-line regexes applied to the result: even an
// unanchored match against this substring alone couldn't reach a line from
// some other section, because that text isn't in the substring at all.
// Originally written just for TENDER TYPE; generalized so every other
// bounded section added in this phase (VAT BREAKDOWN, INCOME / EXPENSE,
// REFUNDS / VOIDS BREAKDOWN, SALES AND INVENTORY DETAILS) gets the identical
// guarantee.
function extractSectionAfter(body: string, markerRe: RegExp): string | null {
  const markerMatch = body.match(markerRe);
  if (!markerMatch || markerMatch.index == null) return null;

  const afterMarker = body.slice(markerMatch.index + markerMatch[0].length);
  const dividerMatch = afterMarker.match(DIVIDER_RE);
  const section = dividerMatch?.index != null ? afterMarker.slice(0, dividerMatch.index) : afterMarker;
  return section;
}

function extractTenderSection(body: string): string | null {
  return extractSectionAfter(body, TENDER_TYPE_MARKER);
}

// DEPARTMENT SALES is bounded by "DEPARTMENT TOTAL" rather than the next
// divider — unlike every other section here, its own content contains two
// "SUB TOTAL" lines that are part of the section, not a terminator.
function extractDepartmentSalesSection(body: string): string | null {
  const markerMatch = body.match(DEPARTMENT_SALES_MARKER_RE);
  if (!markerMatch || markerMatch.index == null) return null;

  const afterMarker = body.slice(markerMatch.index + markerMatch[0].length);
  const totalMatch = afterMarker.match(DEPARTMENT_TOTAL_LINE_RE);
  return totalMatch?.index != null ? afterMarker.slice(0, totalMatch.index) : afterMarker;
}

function parseLabelledLines(section: string): Array<{ label: string; amount: number }> {
  const lines: Array<{ label: string; amount: number }> = [];
  for (const m of section.matchAll(LABELLED_LINE_RE)) {
    lines.push({ label: m[1].trim(), amount: Number(m[2].replace(/,/g, "")) });
  }
  return lines;
}

// Splits the DEPARTMENT SALES section on its (up to two) "SUB TOTAL" lines:
// everything before the first is the merchandise block, everything between
// the first and second (if a second exists) is the INSTANT LOTTERY / LOTTERY
// / PAYPOINT block. A missing SUB TOTAL is treated the same as every other
// missing-but-optional structure in this file — a note, not a hard failure —
// and whatever text there is gets parsed as the merchandise block.
function parseDepartmentLines(body: string, notes: string[]): TillReportDepartmentLine[] {
  const section = extractDepartmentSalesSection(body);
  if (!section) {
    notes.push("no DEPARTMENT SALES section found");
    return [];
  }

  const subTotals = [...section.matchAll(SUB_TOTAL_LINE_RE)];
  let merchandiseText = section;
  let lotteryText: string | null = null;

  if (subTotals.length === 0) {
    notes.push("no SUB TOTAL found in DEPARTMENT SALES section");
  } else {
    const first = subTotals[0];
    merchandiseText = section.slice(0, first.index);
    if (subTotals.length >= 2) {
      const second = subTotals[1];
      lotteryText = section.slice(first.index! + first[0].length, second.index);
    } else {
      notes.push("only one SUB TOTAL found in DEPARTMENT SALES section; no lottery/paypoint group parsed");
    }
  }

  const lines: TillReportDepartmentLine[] = parseLabelledLines(merchandiseText).map((l) => ({
    departmentName: l.label,
    amount: l.amount,
    category: "MERCHANDISE" as const,
  }));

  if (lotteryText) {
    for (const l of parseLabelledLines(lotteryText)) {
      lines.push({ departmentName: l.label, amount: l.amount, category: "LOTTERY_GROUP" });
    }
  }

  if (lines.length === 0) notes.push("DEPARTMENT SALES section found but no department lines parsed");
  return lines;
}

function parseVatLines(body: string, notes: string[]): TillReportVatLine[] {
  const section = extractSectionAfter(body, VAT_BREAKDOWN_MARKER_RE);
  if (!section) {
    notes.push("no VAT BREAKDOWN section found");
    return [];
  }

  const lines: TillReportVatLine[] = [];
  for (const m of section.matchAll(VAT_LINE_RE)) {
    lines.push({
      vatCode: m[1],
      salesExVat: Number(m[2].replace(/,/g, "")),
      vat: Number(m[3].replace(/,/g, "")),
      salesInVat: Number(m[4].replace(/,/g, "")),
    });
  }

  if (lines.length === 0) notes.push("VAT BREAKDOWN section found but no VAT lines parsed");
  return lines;
}

function parseTransactionCount(body: string, notes: string[]): number | null {
  const match = body.match(TRANSACTION_COUNT_RE);
  if (!match) {
    notes.push("no 'No of Transactions' line found");
    return null;
  }
  return Number(match[1]);
}

function parseIncomeExpense(
  body: string,
  notes: string[]
): { lines: TillReportIncomeExpenseLine[]; total: number | null } {
  const section = extractSectionAfter(body, INCOME_EXPENSE_MARKER_RE);
  if (!section) {
    notes.push("no INCOME / EXPENSE section found");
    return { lines: [], total: null };
  }

  const total = parseLabelledAmount(section, INCOME_EXPENSE_TOTAL_RE);
  const lines = parseLabelledLines(section)
    .filter((l) => !INCOME_EXPENSE_TOTAL_LABEL_RE.test(l.label))
    .map((l) => ({ label: l.label, amount: l.amount }));

  return { lines, total };
}

function parseVoidLines(body: string, notes: string[]): TillReportVoidLine[] {
  const section = extractSectionAfter(body, REFUNDS_VOIDS_MARKER_RE);
  if (!section) {
    notes.push("no REFUNDS / VOIDS BREAKDOWN section found");
    return [];
  }

  const lines: TillReportVoidLine[] = [];
  for (const m of section.matchAll(VOID_LINE_RE)) {
    const [, type, dd, mm, yyyy, hh, mi, ss, amount] = m;
    lines.push({
      type: type.replace(/[ \t]+/g, " ").trim(),
      occurredAt: new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss))),
      amount: Number(amount.replace(/,/g, "")),
    });
  }

  return lines;
}

// SALES AND INVENTORY DETAILS has no per-row label — each product line is
// attributed to whichever bare department-name header line (e.g. "ALCOHOL",
// "BAKERY") most recently appeared above it. A product line is distinguished
// from a header line purely by shape: only a product line ends in two
// trailing numeric-ish columns (see PRODUCT_LINE_RE); a header has none.
function parseProductLines(body: string, notes: string[]): TillReportProductLine[] {
  const section = extractSectionAfter(body, SALES_INVENTORY_MARKER_RE);
  if (!section) {
    notes.push("no SALES AND INVENTORY DETAILS section found");
    return [];
  }

  const lines: TillReportProductLine[] = [];
  let currentDepartment: string | null = null;
  let skippedBeforeHeader = 0;

  for (const rawLine of section.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (PRODUCT_HEADER_ROW_RE.test(line)) continue; // "DESCRIPTION ... SALES STOCK" column header

    const match = line.match(PRODUCT_LINE_RE);
    if (match) {
      if (!currentDepartment) {
        skippedBeforeHeader++;
        continue;
      }
      const stockRaw = match[3];
      const stockUnavailable = /^N\/A$/i.test(stockRaw);
      lines.push({
        departmentName: currentDepartment,
        productName: match[1],
        salesQuantity: Number(match[2]),
        stockValue: stockUnavailable ? null : Number(stockRaw),
        stockUnavailable,
      });
    } else {
      currentDepartment = line;
    }
  }

  if (skippedBeforeHeader > 0) {
    notes.push(
      `${skippedBeforeHeader} product line(s) in SALES AND INVENTORY DETAILS skipped: appeared before any department header`
    );
  }
  if (lines.length === 0) notes.push("SALES AND INVENTORY DETAILS section found but no product lines parsed");
  return lines;
}

function resolveReportType(body: string, subject: string | undefined): {
  type: TillReportType | null;
  reportRef: string | null;
  note: string | null;
} {
  const bodyMatch = body.match(REPORT_TYPE_MARKER_RE);
  const bodyType: TillReportType | null = bodyMatch ? (bodyMatch[1].toUpperCase() === "X" ? "X_REPORT" : "Z_REPORT") : null;
  const reportRef = bodyMatch?.[2] ?? null;

  let subjectType: TillReportType | null = null;
  if (subject) {
    if (SUBJECT_X_RE.test(subject)) subjectType = "X_REPORT";
    else if (SUBJECT_Z_RE.test(subject)) subjectType = "Z_REPORT";
  }

  // Body wins when both are present and they disagree — subject has been
  // observed to be generic ("REPORT") or using an older convention ("Z
  // report") in this inbox, while the body's own marker line has been
  // reliable in every real sample seen so far.
  if (bodyType && subjectType && bodyType !== subjectType) {
    return {
      type: bodyType,
      reportRef,
      note: `subject suggests ${subjectType} but body marker says ${bodyType}; body used`,
    };
  }

  const type = bodyType ?? subjectType;
  return {
    type,
    reportRef,
    note: type ? null : "could not determine report type from body marker or subject",
  };
}

/**
 * Parses an X-Report or Z-Report email body (plain text) into its structured
 * fields.
 *
 * businessDate/printedAt are read from the report's own "Date:"/"Time:"
 * fields, not the free-text "<Type>-Report Printed by ... at ..." header
 * line and not the email's received timestamp. This is deliberate: the
 * "Date:"/"Time:" fields have been present and internally consistent in
 * every real sample seen, while the header line has been seen (a) entirely
 * absent from the plain-text body, and (b) present but naming a DIFFERENT
 * date than the "Date:" field on the same report. When the header line IS
 * present and its date matches "Date:", its seconds are borrowed for a more
 * precise printedAt; a mismatch is recorded in parseError as a visible,
 * non-fatal note rather than silently discarded or allowed to override the
 * authoritative fields.
 */
export function parseTillReport(body: string, subject?: string): ParsedTillReport {
  const notes: string[] = [];

  const { type: reportType, reportRef, note: typeNote } = resolveReportType(body, subject);
  if (typeNote) notes.push(typeNote);

  const dateField = parseDateField(body);
  const timeField = parseTimeField(body);
  if (!dateField) notes.push("no Date: field found");
  if (!timeField) notes.push("no Time: field found");

  const businessDate = dateField?.date ?? null;
  const printedMinutes = timeField ? timeField.hours * 60 + timeField.minutes : null;

  let printedAt: Date | null = null;
  if (businessDate && timeField) {
    let seconds = 0;

    const headerMatch = body.match(HEADER_LINE_RE);
    if (headerMatch) {
      const [, , hdd, hmm, hyyyy, hh, hmin, hss] = headerMatch;
      const headerDateMatches =
        Number(hdd) === businessDate.getUTCDate() &&
        Number(hmm) === businessDate.getUTCMonth() + 1 &&
        Number(hyyyy) === businessDate.getUTCFullYear();
      const headerTimeMatches = Number(hh) === timeField.hours && Number(hmin) === timeField.minutes;

      if (headerDateMatches) {
        seconds = Number(hss);
      } else {
        notes.push(
          `header line date (${hdd}/${hmm}/${hyyyy}) differs from Date: field ` +
            `(${String(businessDate.getUTCDate()).padStart(2, "0")}/` +
            `${String(businessDate.getUTCMonth() + 1).padStart(2, "0")}/${businessDate.getUTCFullYear()}); ` +
            `Date: field used as authoritative`
        );
      }
      if (!headerTimeMatches && headerDateMatches) {
        notes.push(`header line time (${hh}:${hmin}) differs from Time: field; Time: field used as authoritative`);
      }
    }

    printedAt = new Date(
      Date.UTC(
        businessDate.getUTCFullYear(),
        businessDate.getUTCMonth(),
        businessDate.getUTCDate(),
        timeField.hours,
        timeField.minutes,
        seconds
      )
    );
  }

  const departmentTotal = parseLabelledAmount(body, /DEPARTMENT\s+TOTAL\s+([\d,]+\.\d{2})/i);
  const grandTotal = parseLabelledAmount(body, GRAND_TOTAL_RE);
  if (departmentTotal == null) notes.push("no DEPARTMENT TOTAL found");

  const tenderSection = extractTenderSection(body);
  const tender: TillReportTender = { cash: null, card: null, manualCard: null };
  if (tenderSection) {
    tender.cash = parseLabelledAmount(tenderSection, CASH_RE);
    tender.card = parseLabelledAmount(tenderSection, CARD_RE);
    tender.manualCard = parseLabelledAmount(tenderSection, MANUAL_CARD_RE);
  } else {
    notes.push("no TENDER TYPE section found");
  }

  const departmentLines = parseDepartmentLines(body, notes);
  const vatLines = parseVatLines(body, notes);
  const transactionCount = parseTransactionCount(body, notes);
  const { lines: incomeExpenseLines, total: incomeExpenseTotal } = parseIncomeExpense(body, notes);
  const voidLines = parseVoidLines(body, notes);
  const productLines = parseProductLines(body, notes);

  return {
    reportType,
    businessDate,
    printedAt,
    printedMinutes,
    reportRef,
    departmentTotal,
    grandTotal,
    tender,
    departmentLines,
    vatLines,
    transactionCount,
    incomeExpenseLines,
    incomeExpenseTotal,
    voidLines,
    productLines,
    parseError: notes.length > 0 ? notes.join("; ") : null,
  };
}
