// Extracts a single "LABEL   amount" figure out of the raw plain-text body of
// a till report email (X-Report or Z-Report). The email body comes from an
// HTML-to-plain-text conversion done by Gmail, so whitespace around the
// label/number (extra spaces, blank lines, tabs) is not reliable — callers
// pass a label pattern that tolerates any run of whitespace between words,
// and this tolerates any run of whitespace before the number itself.
//
// Returns `null` (never a guessed/default value like 0) when the line can't
// be confidently located — a silent 0 would look like a real total and
// create a huge fake variance every time it happens, which is worse than
// clearly signalling "couldn't read it".
export function parseLabelledAmount(body: string, label: RegExp): number | null {
  if (!body) return null;

  const match = body.match(label);
  if (!match) return null;

  const numeric = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;

  return numeric;
}

const DEPARTMENT_TOTAL_RE = /DEPARTMENT\s+TOTAL\s+([\d,]+\.\d{2})/i;

/**
 * Parses the till's "DEPARTMENT TOTAL" figure out of a till report email
 * body. Present on both X-Reports and Z-Reports with an identical label, so
 * this works for either — kept as its own export (rather than folded away
 * once tillReportParser.ts exists) because it is still the one thing every
 * pre-shift call site in the app reaches for.
 */
export function parseDepartmentTotal(body: string): number | null {
  return parseLabelledAmount(body, DEPARTMENT_TOTAL_RE);
}
