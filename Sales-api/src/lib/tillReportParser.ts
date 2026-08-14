import { parseLabelledAmount } from "./departmentTotal.js";

export type TillReportType = "X_REPORT" | "Z_REPORT";

export interface TillReportTender {
  cash: number | null;
  card: number | null;
  manualCard: number | null;
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

// Scopes tender-line parsing to the text between "TENDER TYPE" and the next
// divider — never the whole body. Belt-and-braces alongside the line
// anchoring above: even an unanchored match against this substring alone
// couldn't reach a department line like "GREETING CARDS 1.79" from the
// SALES section above, because that text isn't in the substring at all.
function extractTenderSection(body: string): string | null {
  const markerMatch = body.match(TENDER_TYPE_MARKER);
  if (!markerMatch || markerMatch.index == null) return null;

  const afterMarker = body.slice(markerMatch.index + markerMatch[0].length);
  const dividerMatch = afterMarker.match(DIVIDER_RE);
  const section = dividerMatch?.index != null ? afterMarker.slice(0, dividerMatch.index) : afterMarker;
  return section;
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

  return {
    reportType,
    businessDate,
    printedAt,
    printedMinutes,
    reportRef,
    departmentTotal,
    grandTotal,
    tender,
    parseError: notes.length > 0 ? notes.join("; ") : null,
  };
}
