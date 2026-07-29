// Extracts the till's own reported total ("DEPARTMENT TOTAL") out of the raw
// plain-text body of a Z-Report email. The email body comes from an
// HTML-to-plain-text conversion done by Gmail, so whitespace around the
// label/number (extra spaces, blank lines, tabs) is not reliable — the regex
// below tolerates any run of whitespace between "DEPARTMENT" and "TOTAL" and
// between "TOTAL" and the number itself.
const DEPARTMENT_TOTAL_RE = /DEPARTMENT\s+TOTAL\s+([\d,]+\.\d{2})/i;

/**
 * Parses the till's "DEPARTMENT TOTAL" figure out of a Z-Report email body.
 *
 * Returns `null` (never a guessed/default value like 0) when the line can't
 * be confidently located — a silent 0 would look like a real total and
 * create a huge fake variance every day it happens, which is worse than
 * clearly signalling "couldn't read it".
 */
export function parseDepartmentTotal(body: string): number | null {
  if (!body) return null;

  const match = body.match(DEPARTMENT_TOTAL_RE);
  if (!match) return null;

  const numeric = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;

  return numeric;
}
