import { Prisma, Shift, TillReportType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { dateOnly } from "./activeDate.js";
import { isShiftClosed } from "./storeClosure.js";

// ─────────────────────────────────────────────────────────────────────────
// This module answers a DIFFERENT question from lib/shiftReconciliation.ts.
// shiftReconciliation.ts asks "did staff bank the right cash amount" (till
// vs staff-typed DailySummary figures) and applies VARIANCE_TOLERANCE
// because human cash counting has real-world slop. This module asks "does
// the till's own Shift1 (DAY X) + Shift2 (NIGHT X) data add up to its own
// Z-Report data" — a pure POS-internal consistency check. It is the SAME
// underlying data represented three times by the same machine, not three
// independent countings, so every comparison here is exact-cent
// (variance === 0 to PASS), never tolerance-based. Do not import
// isWithinTolerance/VARIANCE_TOLERANCE here for that reason.
//
// Nothing in this file writes to any table — reconcileDay is a pure read +
// compute, returned fresh on every call. If a persisted/notified version of
// this check is wanted later, that is a separate follow-up, not scope creep
// on top of this module.
// ─────────────────────────────────────────────────────────────────────────

export type CategoryStatus = "PASS" | "FAIL" | "DATA_MISSING" | "NOT_APPLICABLE";

// ── Plain, DB-free input shapes ─────────────────────────────────────────
// reconcileDayFromReports (the actual comparison engine) takes only these —
// no Prisma types, no Decimal instances — so it can be unit tested with
// hand-built objects. reconcileDay (below) is the thin Prisma-fetching
// wrapper that converts real TillReport rows into this shape and calls it.

export interface RawDepartmentLine {
  departmentName: string;
  amount: number;
  category: "MERCHANDISE" | "LOTTERY_GROUP";
}

export interface RawVatLine {
  vatCode: string;
  salesExVat: number;
  vat: number;
  salesInVat: number;
}

export interface RawVoidLine {
  type: string;
  occurredAt: Date;
  amount: number;
}

export interface RawProductLine {
  departmentName: string;
  productName: string;
  salesQuantity: number;
}

export interface RawTillReportRecord {
  tillReportId: number;
  printedAt: Date;
  // Shop-local wall-clock minutes-of-day, taken directly from the report's
  // own "Time:" field (see tillReportParser.ts) — NOT derived from printedAt
  // via activeDate.ts's shopMinutesOfDay. printedAt is deliberately
  // constructed (in the parser) with its UTC fields set to the shop-local
  // wall-clock numbers as printed on the till slip, so re-running it through
  // a real UTC->Europe/London conversion would shift it by the current UTC
  // offset (0 or +1h in BST) and silently corrupt the timing check. This
  // mirrors tillReportIngest.ts, which also classifies shift straight off
  // printedMinutes rather than shopMinutesOfDay(printedAt).
  printedMinutes: number;
  cashTotal: number | null;
  cardTotal: number | null;
  manualCardTotal: number | null;
  grandTotal: number | null;
  transactionCount: number | null;
  incomeExpenseTotal: number | null;
  departmentLines: RawDepartmentLine[];
  vatLines: RawVatLine[];
  voidLines: RawVoidLine[];
  productLines: RawProductLine[];
}

export interface ReconcileDayInput {
  businessDate: Date;
  // All X-Reports ingested for the DAY shift on this date — every one of
  // them, including reprints. Summed per line item inside this module (same
  // additive philosophy as tillReportIngest.ts's getShiftXTotal).
  dayXReports: RawTillReportRecord[];
  nightXReports: RawTillReportRecord[];
  // The single AUTHORITATIVE Z-Report for the date (latest printedAt when
  // more than one exists — same "latest wins" rule as getZReport), or null
  // if none has arrived yet. zReportCount carries how many Z rows actually
  // exist so a duplicate/reprint Z can still be surfaced even though only
  // one of them is used for the comparison.
  zReport: RawTillReportRecord | null;
  zReportCount: number;
  // Issue D: whether the shift is marked Closed (storeClosure.ts) for this
  // businessDate. Optional and defaulted to false inside
  // reconcileDayFromReports, so every existing hand-built test input keeps
  // compiling and passing unchanged — this is purely additive.
  dayClosed?: boolean;
  nightClosed?: boolean;
}

// ── Line-level comparison result shapes ─────────────────────────────────

export interface UnionLineResult {
  key: string; // departmentName or productName
  category?: "MERCHANDISE" | "LOTTERY_GROUP"; // department lines only
  extra?: string; // product lines only: the department the product was sold under
  s1: number | null;
  s2: number | null;
  expected: number | null; // null only for the "appears only in Z" DATA_MISSING case
  actual: number | null;
  variance: number | null;
  status: CategoryStatus;
  note: string | null;
}

export interface VatFieldComparison {
  s1: number | null;
  s2: number | null;
  expected: number | null;
  actual: number | null;
  variance: number | null;
  status: CategoryStatus;
}

export interface VatLineResult {
  vatCode: string;
  salesExVat: VatFieldComparison;
  vat: VatFieldComparison;
  salesInVat: VatFieldComparison;
  status: CategoryStatus;
  note: string | null;
}

export interface SingleValueResult {
  label: string;
  s1: number | null;
  s2: number | null;
  expected: number | null;
  actual: number | null;
  variance: number | null;
  status: CategoryStatus;
  note: string | null;
}

export interface VoidTupleResult {
  type: string;
  occurredAt: string; // ISO
  amount: number;
  expectedCount: number; // combined S1+S2 occurrences of this exact (type, occurredAt, amount)
  actualCount: number; // Z occurrences of the same tuple
  matchedCount: number;
  missingCount: number; // in S1/S2 but not carried through to Z
  unexpectedCount: number; // in Z with zero basis in S1/S2
  duplicateCount: number; // in Z in excess of what S1/S2 justify, where S1/S2 DID have at least one
  status: CategoryStatus;
}

export interface VoidCategoryResult {
  status: CategoryStatus;
  tuples: VoidTupleResult[];
  summary: { totalMissing: number; totalUnexpected: number; totalDuplicate: number };
}

export interface TimingCheckResult {
  tillReportId: number;
  role: "DAY_X" | "NIGHT_X" | "Z";
  printedAt: string; // ISO
  printedMinutes: number;
  expectedWindowMinutes: [number, number];
  withinWindow: boolean;
}

export interface ExceptionRecord {
  category: "DEPARTMENT" | "VAT" | "TENDER" | "TRANSACTION_COUNT" | "INCOME_EXPENSE" | "VOID" | "PRODUCT" | "TIMING";
  key: string;
  s1: number | null;
  s2: number | null;
  expected: number | null;
  actual: number | null;
  variance: number | null;
  status: CategoryStatus | "TIMING_EXCEPTION";
  hint: string;
}

export interface ReconcileDayResult {
  businessDate: string; // yyyy-mm-dd
  reportPresence: {
    // closed = this shift is marked Closed (storeClosure.ts) for this date —
    // lets the UI distinguish "closed, not expected" from "not received yet"
    // even though both count as `present` for the waiting-for calculation.
    dayX: { present: boolean; count: number; reportIds: number[]; closed: boolean };
    nightX: { present: boolean; count: number; reportIds: number[]; closed: boolean };
    // count = every Z row found for the date (including reprints/duplicates);
    // reportIds = the one actually used (latest printedAt), same rule as
    // tillReportIngest.ts's getZReport.
    z: { present: boolean; count: number; reportIds: number[] };
  };
  overallStatus:
    | "RECONCILED"
    | "EXCEPTION"
    | "WAITING_FOR_DAY_X"
    | "WAITING_FOR_NIGHT_X"
    | "WAITING_FOR_Z"
    | "WAITING_FOR_REPORTS"
    // Both shifts closed for this date — nothing was ever expected here, so
    // this is a resting state, not a variant of "waiting". Deliberately does
    // not attempt to detect a stray report on an otherwise fully-closed day
    // (see closureNotes below for the SINGLE-shift-closed-but-reported case,
    // which this status does not cover).
    | "CLOSED";
  waitingFor: Array<"DAY_X" | "NIGHT_X" | "Z">;
  // Non-fatal notes surfacing an inconsistency between closure state and
  // actual ingested data — e.g. a shift marked Closed that nonetheless has
  // real X-Report(s) on file. Per the app's "never silently drop real data"
  // rule, ingestion always stores such a report normally; this is where that
  // inconsistency becomes visible instead of silently hidden.
  closureNotes: string[];
  timing: TimingCheckResult[];
  timingExceptionCount: number;
  categories: {
    department: { status: CategoryStatus; lines: UnionLineResult[] };
    vat: { status: CategoryStatus; lines: VatLineResult[] };
    tender: {
      status: CategoryStatus;
      cash: SingleValueResult;
      card: SingleValueResult;
      manualCard: SingleValueResult;
      grandTotal: SingleValueResult;
    };
    transactionCount: SingleValueResult;
    incomeExpense: SingleValueResult;
    void: VoidCategoryResult;
    product: { status: CategoryStatus; lines: UnionLineResult[]; nearDuplicateWarnings: string[] };
  };
  exceptions: ExceptionRecord[];
}

// ── Small helpers ────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatMinutes(m: number): string {
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const mi = (m % 60).toString().padStart(2, "0");
  return `${h}:${mi}`;
}

function worstStatus(statuses: CategoryStatus[]): CategoryStatus {
  if (statuses.some((s) => s === "DATA_MISSING")) return "DATA_MISSING";
  if (statuses.some((s) => s === "FAIL")) return "FAIL";
  return "PASS";
}

// ── Reprint-summing aggregation (step 1 of the spec) ────────────────────

interface ShiftAggregate {
  count: number;
  reportIds: number[];
  departmentTotals: Map<string, { amount: number; category: "MERCHANDISE" | "LOTTERY_GROUP" }>;
  vatTotals: Map<string, { salesExVat: number; vat: number; salesInVat: number }>;
  productTotals: Map<string, { departmentName: string; salesQuantity: number }>;
  voidLines: RawVoidLine[];
  cashTotal: number | null;
  cardTotal: number | null;
  manualCardTotal: number | null;
  grandTotal: number | null;
  transactionCount: number | null;
  incomeExpenseTotal: number | null;
}

// Mirrors getShiftXTotal's null-propagation rule: if ANY report contributing
// to this shift is missing the field, the shift total is unknown (null),
// never a silently-partial sum treating the missing one as zero.
function sumNullable(reports: RawTillReportRecord[], pick: (r: RawTillReportRecord) => number | null): number | null {
  if (reports.length === 0) return null;
  if (reports.some((r) => pick(r) == null)) return null;
  return round2(reports.reduce((sum, r) => sum + (pick(r) as number), 0));
}

export function aggregateShift(reports: RawTillReportRecord[]): ShiftAggregate {
  const departmentTotals = new Map<string, { amount: number; category: "MERCHANDISE" | "LOTTERY_GROUP" }>();
  const vatTotals = new Map<string, { salesExVat: number; vat: number; salesInVat: number }>();
  const productTotals = new Map<string, { departmentName: string; salesQuantity: number }>();
  const voidLines: RawVoidLine[] = [];

  for (const report of reports) {
    for (const line of report.departmentLines) {
      const existing = departmentTotals.get(line.departmentName);
      departmentTotals.set(line.departmentName, {
        amount: round2((existing?.amount ?? 0) + line.amount),
        category: existing?.category ?? line.category,
      });
    }
    for (const line of report.vatLines) {
      const existing = vatTotals.get(line.vatCode);
      vatTotals.set(line.vatCode, {
        salesExVat: round2((existing?.salesExVat ?? 0) + line.salesExVat),
        vat: round2((existing?.vat ?? 0) + line.vat),
        salesInVat: round2((existing?.salesInVat ?? 0) + line.salesInVat),
      });
    }
    for (const line of report.productLines) {
      const existing = productTotals.get(line.productName);
      productTotals.set(line.productName, {
        departmentName: existing?.departmentName ?? line.departmentName,
        salesQuantity: (existing?.salesQuantity ?? 0) + line.salesQuantity,
      });
    }
    // Void lines are discrete events, not amounts to sum — reprints
    // contribute the union of whatever void/drawer events each X-Report in
    // the shift shows (consistent with "each X resets" — see
    // getShiftXTotal's doc comment — so distinct X-Reports in a shift are
    // expected to carry distinct events, not the same ones repeated).
    voidLines.push(...report.voidLines);
  }

  return {
    count: reports.length,
    reportIds: reports.map((r) => r.tillReportId),
    departmentTotals,
    vatTotals,
    productTotals,
    voidLines,
    cashTotal: sumNullable(reports, (r) => r.cashTotal),
    cardTotal: sumNullable(reports, (r) => r.cardTotal),
    manualCardTotal: sumNullable(reports, (r) => r.manualCardTotal),
    grandTotal: sumNullable(reports, (r) => r.grandTotal),
    transactionCount: sumNullable(reports, (r) => r.transactionCount),
    incomeExpenseTotal: sumNullable(reports, (r) => r.incomeExpenseTotal),
  };
}

// ── Department reconciliation (step 2) ──────────────────────────────────

function compareDepartmentLines(
  s1Map: ShiftAggregate["departmentTotals"],
  s2Map: ShiftAggregate["departmentTotals"],
  zMap: ShiftAggregate["departmentTotals"]
): UnionLineResult[] {
  const keys = new Set<string>([...s1Map.keys(), ...s2Map.keys(), ...zMap.keys()]);
  const results: UnionLineResult[] = [];

  for (const key of keys) {
    const inS1 = s1Map.has(key);
    const inS2 = s2Map.has(key);
    const inZ = zMap.has(key);
    const s1 = s1Map.get(key)?.amount ?? null;
    const s2 = s2Map.get(key)?.amount ?? null;
    const z = zMap.get(key)?.amount ?? null;
    const category = s1Map.get(key)?.category ?? s2Map.get(key)?.category ?? zMap.get(key)?.category;

    // Appears ONLY in Z, in neither shift: cannot compute an expected value
    // at all — flag explicitly rather than silently assuming expected=0.
    if (!inS1 && !inS2 && inZ) {
      results.push({
        key,
        category,
        s1,
        s2,
        expected: null,
        actual: z,
        variance: null,
        status: "DATA_MISSING",
        note: `Department "${key}" appears on the Z-Report but not on either shift's X-Report. Check for a missing/failed X-Report or a mistyped department name.`,
      });
      continue;
    }

    const expected = round2((s1 ?? 0) + (s2 ?? 0));
    const actual = round2(z ?? 0);
    const variance = round2(actual - expected);
    results.push({
      key,
      category,
      s1,
      s2,
      expected,
      actual,
      variance,
      status: variance === 0 ? "PASS" : "FAIL",
      note:
        variance === 0
          ? null
          : `Department "${key}": Z-Report shows ${actual.toFixed(2)}, Day+Night X-Reports summed to ${expected.toFixed(2)} (${variance > 0 ? "over" : "under"} by ${Math.abs(variance).toFixed(2)}).`,
    });
  }

  return results.sort((a, b) => a.key.localeCompare(b.key));
}

// ── VAT reconciliation (step 3) ─────────────────────────────────────────

function compareVatField(
  inS1: boolean,
  inS2: boolean,
  inZ: boolean,
  s1: number | null,
  s2: number | null,
  z: number | null
): VatFieldComparison {
  if (!inS1 && !inS2 && inZ) {
    return { s1, s2, expected: null, actual: z, variance: null, status: "DATA_MISSING" };
  }
  const expected = round2((s1 ?? 0) + (s2 ?? 0));
  const actual = round2(z ?? 0);
  const variance = round2(actual - expected);
  return { s1, s2, expected, actual, variance, status: variance === 0 ? "PASS" : "FAIL" };
}

function compareVatLines(
  s1Map: ShiftAggregate["vatTotals"],
  s2Map: ShiftAggregate["vatTotals"],
  zMap: ShiftAggregate["vatTotals"]
): VatLineResult[] {
  const codes = new Set<string>([...s1Map.keys(), ...s2Map.keys(), ...zMap.keys()]);
  const results: VatLineResult[] = [];

  for (const code of codes) {
    const inS1 = s1Map.has(code);
    const inS2 = s2Map.has(code);
    const inZ = zMap.has(code);
    const s1 = s1Map.get(code) ?? null;
    const s2 = s2Map.get(code) ?? null;
    const z = zMap.get(code) ?? null;

    const salesExVat = compareVatField(inS1, inS2, inZ, s1?.salesExVat ?? null, s2?.salesExVat ?? null, z?.salesExVat ?? null);
    const vat = compareVatField(inS1, inS2, inZ, s1?.vat ?? null, s2?.vat ?? null, z?.vat ?? null);
    const salesInVat = compareVatField(
      inS1,
      inS2,
      inZ,
      s1?.salesInVat ?? null,
      s2?.salesInVat ?? null,
      z?.salesInVat ?? null
    );
    const status = worstStatus([salesExVat.status, vat.status, salesInVat.status]);

    results.push({
      vatCode: code,
      salesExVat,
      vat,
      salesInVat,
      status,
      note:
        status === "PASS"
          ? null
          : `VAT code "${code}": salesExVat/vat/salesInVat did not all reconcile between the shifts and the Z-Report.`,
    });
  }

  return results.sort((a, b) => a.vatCode.localeCompare(b.vatCode));
}

// ── Single-value comparisons: tender, transaction count, income/expense ──
// (steps 4/5/6)

function compareSingleValue(label: string, s1: number | null, s2: number | null, z: number | null): SingleValueResult {
  if (s1 == null || s2 == null || z == null) {
    return {
      label,
      s1,
      s2,
      expected: null,
      actual: z,
      variance: null,
      status: "DATA_MISSING",
      note: `${label}: could not compare — this figure failed to parse on at least one of the Day X, Night X, or Z reports.`,
    };
  }
  const expected = round2(s1 + s2);
  const actual = round2(z);
  const variance = round2(actual - expected);
  return {
    label,
    s1,
    s2,
    expected,
    actual,
    variance,
    status: variance === 0 ? "PASS" : "FAIL",
    note:
      variance === 0
        ? null
        : `${label}: Z-Report ${actual.toFixed(2)} vs Day+Night sum ${expected.toFixed(2)} (${variance > 0 ? "over" : "under"} by ${Math.abs(variance).toFixed(2)}).`,
  };
}

function naSingleValue(label: string, note: string): SingleValueResult {
  return { label, s1: null, s2: null, expected: null, actual: null, variance: null, status: "NOT_APPLICABLE", note };
}

// ── Void/refund reconciliation (step 7) ─────────────────────────────────
// Matched on (category, occurredAt, amount), comparing the actual matched
// multisets rather than bare counts, per the spec's explicit instruction.
// Three distinguishable outcomes per tuple:
//   - missingCount:    in S1/S2 but never carried through to Z
//   - unexpectedCount: in Z with ZERO basis in S1/S2 (appeared out of nowhere)
//   - duplicateCount:  in Z MORE times than S1/S2 justify, where S1/S2 had
//                       at least one (the tuple is real, but over-represented)
//
// The till's own "type" label (e.g. "Voided - 04") carries a sequence number
// that restarts at 01 within EACH report but runs cumulatively across the
// whole day on the Z-Report — confirmed against real data, where a shift's
// own "Voided - 01" prints as "Voided - 04" on that same day's Z-Report,
// same occurredAt/amount. The number is therefore not a stable identifier
// across reports; only the category prefix before " - NN" is. Matching on
// the full label made every real void look like a mismatch. The full label
// is still kept for display (see `sample.type` below), just not as the key.

function voidCategory(type: string): string {
  return type.replace(/\s*-\s*\d+\s*$/, "").trim();
}

function voidKey(v: RawVoidLine): string {
  return `${voidCategory(v.type)}|${v.occurredAt.toISOString()}|${v.amount.toFixed(2)}`;
}

function compareVoidLines(shiftVoids: RawVoidLine[], zVoids: RawVoidLine[]): VoidCategoryResult {
  const expectedCounts = new Map<string, { count: number; sample: RawVoidLine }>();
  for (const v of shiftVoids) {
    const k = voidKey(v);
    expectedCounts.set(k, { count: (expectedCounts.get(k)?.count ?? 0) + 1, sample: v });
  }
  const actualCounts = new Map<string, { count: number; sample: RawVoidLine }>();
  for (const v of zVoids) {
    const k = voidKey(v);
    actualCounts.set(k, { count: (actualCounts.get(k)?.count ?? 0) + 1, sample: v });
  }

  const keys = new Set<string>([...expectedCounts.keys(), ...actualCounts.keys()]);
  const tuples: VoidTupleResult[] = [];
  let totalMissing = 0;
  let totalUnexpected = 0;
  let totalDuplicate = 0;

  for (const k of keys) {
    const expected = expectedCounts.get(k);
    const actual = actualCounts.get(k);
    const expectedCount = expected?.count ?? 0;
    const actualCount = actual?.count ?? 0;
    const matchedCount = Math.min(expectedCount, actualCount);
    const missingCount = Math.max(0, expectedCount - actualCount);
    const excess = Math.max(0, actualCount - expectedCount);
    const unexpectedCount = expectedCount === 0 ? excess : 0;
    const duplicateCount = expectedCount > 0 ? excess : 0;

    totalMissing += missingCount;
    totalUnexpected += unexpectedCount;
    totalDuplicate += duplicateCount;

    const sample = (actual ?? expected)!.sample;
    tuples.push({
      type: sample.type,
      occurredAt: sample.occurredAt.toISOString(),
      amount: sample.amount,
      expectedCount,
      actualCount,
      matchedCount,
      missingCount,
      unexpectedCount,
      duplicateCount,
      status: missingCount === 0 && unexpectedCount === 0 && duplicateCount === 0 ? "PASS" : "FAIL",
    });
  }

  tuples.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.type.localeCompare(b.type));

  return {
    status: totalMissing === 0 && totalUnexpected === 0 && totalDuplicate === 0 ? "PASS" : "FAIL",
    tuples,
    summary: { totalMissing, totalUnexpected, totalDuplicate },
  };
}

// ── Product quantity reconciliation (step 8) ────────────────────────────

function compareProductLines(
  s1Map: ShiftAggregate["productTotals"],
  s2Map: ShiftAggregate["productTotals"],
  zMap: ShiftAggregate["productTotals"]
): UnionLineResult[] {
  const keys = new Set<string>([...s1Map.keys(), ...s2Map.keys(), ...zMap.keys()]);
  const results: UnionLineResult[] = [];

  for (const key of keys) {
    const inS1 = s1Map.has(key);
    const inS2 = s2Map.has(key);
    const inZ = zMap.has(key);
    const s1 = s1Map.get(key)?.salesQuantity ?? null;
    const s2 = s2Map.get(key)?.salesQuantity ?? null;
    const z = zMap.get(key)?.salesQuantity ?? null;
    const extra = s1Map.get(key)?.departmentName ?? s2Map.get(key)?.departmentName ?? zMap.get(key)?.departmentName;

    if (!inS1 && !inS2 && inZ) {
      results.push({
        key,
        extra,
        s1,
        s2,
        expected: null,
        actual: z,
        variance: null,
        status: "DATA_MISSING",
        note: `Product "${key}" appears in the Z-Report's sales/inventory listing but not on either shift's X-Report. A product legitimately appearing on only ONE shift is normal — this is different: it is on neither.`,
      });
      continue;
    }

    const expected = (s1 ?? 0) + (s2 ?? 0);
    const actual = z ?? 0;
    const variance = actual - expected;
    results.push({
      key,
      extra,
      s1,
      s2,
      expected,
      actual,
      variance,
      status: variance === 0 ? "PASS" : "FAIL",
      note:
        variance === 0
          ? null
          : `Product "${key}": Z-Report qty ${actual} vs Day+Night sum ${expected} (${variance > 0 ? "over" : "under"} by ${Math.abs(variance)}).`,
    });
  }

  return results.sort((a, b) => a.key.localeCompare(b.key));
}

// Soft, informational-only near-duplicate detector: normalizes case,
// whitespace and punctuation and flags two DIFFERENT verbatim names that
// collide once normalized. Never merges quantities across them — each
// verbatim name still gets its own row in compareProductLines above. This
// is deliberately a conservative "same after normalizing" check, not fuzzy
///edit-distance matching, so it can't itself introduce a false merge.
function normalizeProductName(name: string): string {
  // Strips ALL whitespace/punctuation (not just collapsing it) — till
  // software has been observed to vary spacing around units inconsistently
  // ("650ML" vs "650 ML"), so whitespace differences alone shouldn't hide a
  // likely-same product from this warning.
  return name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function findNearDuplicateProductNames(names: Iterable<string>): string[] {
  const byNormalized = new Map<string, Set<string>>();
  for (const name of names) {
    const norm = normalizeProductName(name);
    if (!byNormalized.has(norm)) byNormalized.set(norm, new Set());
    byNormalized.get(norm)!.add(name);
  }
  const warnings: string[] = [];
  for (const variants of byNormalized.values()) {
    if (variants.size > 1) {
      warnings.push(
        `Possible near-duplicate product names (NOT merged, shown as separate rows): ${[...variants]
          .sort()
          .map((v) => `"${v}"`)
          .join(", ")}`
      );
    }
  }
  return warnings.sort();
}

// ── Timing validation (step 9) ──────────────────────────────────────────

const DAY_WINDOW_MINUTES: [number, number] = [12 * 60, 15 * 60]; // 12:00–15:00
const NIGHT_Z_WINDOW_MINUTES: [number, number] = [21 * 60, 23 * 60]; // 21:00–23:00

function checkTiming(report: RawTillReportRecord, role: "DAY_X" | "NIGHT_X" | "Z"): TimingCheckResult {
  const window = role === "DAY_X" ? DAY_WINDOW_MINUTES : NIGHT_Z_WINDOW_MINUTES;
  const withinWindow = report.printedMinutes >= window[0] && report.printedMinutes <= window[1];
  return {
    tillReportId: report.tillReportId,
    role,
    printedAt: report.printedAt.toISOString(),
    printedMinutes: report.printedMinutes,
    expectedWindowMinutes: window,
    withinWindow,
  };
}

// ── Missing-report day status (steps 10/11) ─────────────────────────────

const WAITING_STATUS: Record<"DAY_X" | "NIGHT_X" | "Z", ReconcileDayResult["overallStatus"]> = {
  DAY_X: "WAITING_FOR_DAY_X",
  NIGHT_X: "WAITING_FOR_NIGHT_X",
  Z: "WAITING_FOR_Z",
};

/**
 * The pure comparison engine: takes already-loaded S1 (DAY X)/S2 (NIGHT
 * X)/Z report data (with reprints not yet summed — that happens inside, via
 * aggregateShift) and returns the full reconciliation result. No I/O, no
 * Prisma — this is what unit tests exercise directly. See reconcileDay
 * below for the DB-fetching wrapper.
 */
export function reconcileDayFromReports(input: ReconcileDayInput): ReconcileDayResult {
  const dayClosed = input.dayClosed ?? false;
  const nightClosed = input.nightClosed ?? false;
  const bothClosed = dayClosed && nightClosed;

  const dayAgg = aggregateShift(input.dayXReports);
  const nightAgg = aggregateShift(input.nightXReports);
  const zAgg = aggregateShift(input.zReport ? [input.zReport] : []);

  // The actual bug fix (see the module-level verification notes this was
  // derived from): sumNullable([], ...) returns null for an empty report
  // list, not 0, and compareSingleValue below treats ANY null among
  // s1/s2/z as DATA_MISSING. A closed shift legitimately has zero reports —
  // that must read as "nothing happened here" (0), not "data failed to
  // parse" (null). Deliberately narrow: only these six single-value fields
  // need coercing. The Map-based comparisons (department/VAT/product) do NOT
  // need this — aggregateShift([]) already hands them empty maps, and their
  // union-of-keys + `?? 0` logic already treats "absent from one shift" as a
  // normal 0-fill, only flagging DATA_MISSING when a key is absent from
  // BOTH shifts. Building a separate "closedShiftAggregate()" would
  // needlessly duplicate that already-correct behaviour.
  if (dayClosed) {
    dayAgg.cashTotal ??= 0;
    dayAgg.cardTotal ??= 0;
    dayAgg.manualCardTotal ??= 0;
    dayAgg.grandTotal ??= 0;
    dayAgg.transactionCount ??= 0;
    dayAgg.incomeExpenseTotal ??= 0;
  }
  if (nightClosed) {
    nightAgg.cashTotal ??= 0;
    nightAgg.cardTotal ??= 0;
    nightAgg.manualCardTotal ??= 0;
    nightAgg.grandTotal ??= 0;
    nightAgg.transactionCount ??= 0;
    nightAgg.incomeExpenseTotal ??= 0;
  }

  // A closed shift counts as "present" for the waiting-for calculation even
  // with zero actual reports — this is the literal fix for "Day closed
  // shouldn't produce WAITING_FOR_DAY_X forever".
  const dayXPresent = input.dayXReports.length > 0 || dayClosed;
  const nightXPresent = input.nightXReports.length > 0 || nightClosed;
  const zPresent = input.zReport != null;

  // A report arriving for a shift already marked Closed is never blocked or
  // dropped at ingestion (see tillReportIngest.ts — it has no lock/closure
  // check at all) — this is where that inconsistency becomes a visible note
  // instead of silently disappearing. Independent of bothClosed below: it
  // fires even inside the fully-closed short-circuit, since it is not part
  // of "the comparison pipeline" being skipped, just an informational flag.
  const closureNotes: string[] = [];
  if (dayClosed && input.dayXReports.length > 0) {
    closureNotes.push(
      `Day shift is marked Closed, but ${input.dayXReports.length} X-Report(s) were received for it — check for a mistaken closure or a report sent in error.`
    );
  }
  if (nightClosed && input.nightXReports.length > 0) {
    closureNotes.push(
      `Night shift is marked Closed, but ${input.nightXReports.length} X-Report(s) were received for it — check for a mistaken closure or a report sent in error.`
    );
  }

  // Both shifts closed: skip the whole comparison pipeline outright, even if
  // Z happens to be missing/present — a day nobody worked will very likely
  // never get a Z-Report either, so falling through to WAITING_FOR_Z would
  // wait forever. Deliberately does not try to detect a stray report on an
  // otherwise fully-closed day beyond the closureNotes above — explicit
  // scope boundary, not an oversight.
  const waitingFor: Array<"DAY_X" | "NIGHT_X" | "Z"> = [];
  if (!bothClosed) {
    if (!dayXPresent) waitingFor.push("DAY_X");
    if (!nightXPresent) waitingFor.push("NIGHT_X");
    if (!zPresent) waitingFor.push("Z");
  }
  const reportsComplete = !bothClosed && waitingFor.length === 0;
  const missingNote = bothClosed
    ? "This date is marked Closed for both shifts — reconciliation is not applicable."
    : `Cannot reconcile yet: missing ${waitingFor.join(", ")} for this date.`;

  // Timing runs regardless of completeness — it's useful signal even on a
  // day that's still waiting for other reports, and per the spec a report
  // outside its window is flagged but still fully processed, never skipped.
  const timing: TimingCheckResult[] = [
    ...input.dayXReports.map((r) => checkTiming(r, "DAY_X")),
    ...input.nightXReports.map((r) => checkTiming(r, "NIGHT_X")),
    ...(input.zReport ? [checkTiming(input.zReport, "Z")] : []),
  ];
  const timingExceptionCount = timing.filter((t) => !t.withinWindow).length;

  const departmentLines = reportsComplete
    ? compareDepartmentLines(dayAgg.departmentTotals, nightAgg.departmentTotals, zAgg.departmentTotals)
    : [];
  const department = {
    status: reportsComplete ? worstStatus(departmentLines.map((l) => l.status)) : ("NOT_APPLICABLE" as CategoryStatus),
    lines: departmentLines,
  };

  const vatLines = reportsComplete ? compareVatLines(dayAgg.vatTotals, nightAgg.vatTotals, zAgg.vatTotals) : [];
  const vat = {
    status: reportsComplete ? worstStatus(vatLines.map((l) => l.status)) : ("NOT_APPLICABLE" as CategoryStatus),
    lines: vatLines,
  };

  const cash = reportsComplete
    ? compareSingleValue("Cash", dayAgg.cashTotal, nightAgg.cashTotal, zAgg.cashTotal)
    : naSingleValue("Cash", missingNote);
  const card = reportsComplete
    ? compareSingleValue("Card", dayAgg.cardTotal, nightAgg.cardTotal, zAgg.cardTotal)
    : naSingleValue("Card", missingNote);
  const manualCard = reportsComplete
    ? compareSingleValue("Manual Card", dayAgg.manualCardTotal, nightAgg.manualCardTotal, zAgg.manualCardTotal)
    : naSingleValue("Manual Card", missingNote);
  const grandTotal = reportsComplete
    ? compareSingleValue("Grand Total", dayAgg.grandTotal, nightAgg.grandTotal, zAgg.grandTotal)
    : naSingleValue("Grand Total", missingNote);
  const tender = {
    status: reportsComplete
      ? worstStatus([cash.status, card.status, manualCard.status, grandTotal.status])
      : ("NOT_APPLICABLE" as CategoryStatus),
    cash,
    card,
    manualCard,
    grandTotal,
  };

  const transactionCount = reportsComplete
    ? compareSingleValue("Transaction Count", dayAgg.transactionCount, nightAgg.transactionCount, zAgg.transactionCount)
    : naSingleValue("Transaction Count", missingNote);
  const incomeExpense = reportsComplete
    ? compareSingleValue(
        "Income/Expense Total",
        dayAgg.incomeExpenseTotal,
        nightAgg.incomeExpenseTotal,
        zAgg.incomeExpenseTotal
      )
    : naSingleValue("Income/Expense Total", missingNote);

  const voidResult: VoidCategoryResult = reportsComplete
    ? compareVoidLines([...dayAgg.voidLines, ...nightAgg.voidLines], zAgg.voidLines)
    : { status: "NOT_APPLICABLE", tuples: [], summary: { totalMissing: 0, totalUnexpected: 0, totalDuplicate: 0 } };

  const productLines = reportsComplete
    ? compareProductLines(dayAgg.productTotals, nightAgg.productTotals, zAgg.productTotals)
    : [];
  const allProductNames = reportsComplete
    ? [...dayAgg.productTotals.keys(), ...nightAgg.productTotals.keys(), ...zAgg.productTotals.keys()]
    : [];
  const product = {
    status: reportsComplete ? worstStatus(productLines.map((l) => l.status)) : ("NOT_APPLICABLE" as CategoryStatus),
    lines: productLines,
    nearDuplicateWarnings: findNearDuplicateProductNames(allProductNames),
  };

  // ── Flat exceptions list (step 11) ──
  const exceptions: ExceptionRecord[] = [];

  for (const line of department.lines) {
    if (line.status !== "PASS") {
      exceptions.push({
        category: "DEPARTMENT",
        key: line.category ? `${line.key} (${line.category})` : line.key,
        s1: line.s1,
        s2: line.s2,
        expected: line.expected,
        actual: line.actual,
        variance: line.variance,
        status: line.status,
        hint: line.note ?? "",
      });
    }
  }

  for (const line of vat.lines) {
    if (line.status !== "PASS") {
      exceptions.push({
        category: "VAT",
        key: `VAT ${line.vatCode}`,
        s1: line.salesInVat.s1,
        s2: line.salesInVat.s2,
        expected: line.salesInVat.expected,
        actual: line.salesInVat.actual,
        variance: line.salesInVat.variance,
        status: line.status,
        hint: line.note ?? "",
      });
    }
  }

  const pushSingle = (category: ExceptionRecord["category"], r: SingleValueResult) => {
    if (r.status !== "PASS" && r.status !== "NOT_APPLICABLE") {
      exceptions.push({
        category,
        key: r.label,
        s1: r.s1,
        s2: r.s2,
        expected: r.expected,
        actual: r.actual,
        variance: r.variance,
        status: r.status,
        hint: r.note ?? "",
      });
    }
  };
  pushSingle("TENDER", cash);
  pushSingle("TENDER", card);
  pushSingle("TENDER", manualCard);
  pushSingle("TENDER", grandTotal);
  pushSingle("TRANSACTION_COUNT", transactionCount);
  pushSingle("INCOME_EXPENSE", incomeExpense);

  for (const t of voidResult.tuples) {
    if (t.status !== "PASS") {
      const parts: string[] = [];
      if (t.missingCount > 0)
        parts.push(`${t.missingCount} occurrence(s) on the shift X-Report(s) never carried through to the Z-Report`);
      if (t.unexpectedCount > 0)
        parts.push(`${t.unexpectedCount} occurrence(s) on the Z-Report have no matching shift X-Report entry`);
      if (t.duplicateCount > 0)
        parts.push(
          `${t.duplicateCount} occurrence(s) on the Z-Report exceed what the shift X-Reports justify (possible duplicate)`
        );
      exceptions.push({
        category: "VOID",
        key: `${t.type} @ ${t.occurredAt} (${t.amount.toFixed(2)})`,
        s1: null,
        s2: null,
        expected: t.expectedCount,
        actual: t.actualCount,
        variance: t.actualCount - t.expectedCount,
        status: t.status,
        hint: parts.join("; "),
      });
    }
  }

  for (const line of product.lines) {
    if (line.status !== "PASS") {
      exceptions.push({
        category: "PRODUCT",
        key: line.extra ? `${line.key} (${line.extra})` : line.key,
        s1: line.s1,
        s2: line.s2,
        expected: line.expected,
        actual: line.actual,
        variance: line.variance,
        status: line.status,
        hint: line.note ?? "",
      });
    }
  }

  for (const t of timing) {
    if (!t.withinWindow) {
      exceptions.push({
        category: "TIMING",
        key: `${t.role} report #${t.tillReportId}`,
        s1: null,
        s2: null,
        expected: null,
        actual: t.printedMinutes,
        variance: null,
        status: "TIMING_EXCEPTION",
        hint: `${t.role} report printed at ${formatMinutes(t.printedMinutes)}, outside the expected ${formatMinutes(t.expectedWindowMinutes[0])}–${formatMinutes(t.expectedWindowMinutes[1])} window. Still fully compared above — verify this wasn't printed at the wrong time or on the wrong day.`,
      });
    }
  }

  // ── Overall roll-up ──
  let overallStatus: ReconcileDayResult["overallStatus"];
  if (bothClosed) {
    overallStatus = "CLOSED";
  } else if (!reportsComplete) {
    overallStatus = waitingFor.length === 1 ? WAITING_STATUS[waitingFor[0]] : "WAITING_FOR_REPORTS";
  } else {
    const categoryStatuses: CategoryStatus[] = [
      department.status,
      vat.status,
      tender.status,
      transactionCount.status,
      incomeExpense.status,
      voidResult.status,
      product.status,
    ];
    overallStatus = categoryStatuses.some((s) => s === "FAIL" || s === "DATA_MISSING") ? "EXCEPTION" : "RECONCILED";
  }

  return {
    businessDate: dateOnly(input.businessDate).toISOString().split("T")[0],
    reportPresence: {
      dayX: { present: dayXPresent, count: input.dayXReports.length, reportIds: dayAgg.reportIds, closed: dayClosed },
      nightX: {
        present: nightXPresent,
        count: input.nightXReports.length,
        reportIds: nightAgg.reportIds,
        closed: nightClosed,
      },
      z: { present: zPresent, count: input.zReportCount, reportIds: input.zReport ? [input.zReport.tillReportId] : [] },
    },
    overallStatus,
    waitingFor,
    closureNotes,
    timing,
    timingExceptionCount,
    categories: { department, vat, tender, transactionCount, incomeExpense, void: voidResult, product },
    exceptions,
  };
}

// ── Prisma-fetching wrapper ──────────────────────────────────────────────

export const CHILD_INCLUDE = {
  departmentLines: true,
  vatLines: true,
  incomeExpenseLines: true,
  voidLines: true,
  productLines: true,
} satisfies Prisma.TillReportInclude;

type TillReportWithChildren = Prisma.TillReportGetPayload<{ include: typeof CHILD_INCLUDE }>;

function toNum(d: Prisma.Decimal | null): number | null {
  return d == null ? null : Number(d);
}

export function toRawReport(r: TillReportWithChildren): RawTillReportRecord {
  return {
    tillReportId: r.tillReportId,
    printedAt: r.printedAt,
    printedMinutes: r.printedMinutes,
    cashTotal: toNum(r.cashTotal),
    cardTotal: toNum(r.cardTotal),
    manualCardTotal: toNum(r.manualCardTotal),
    grandTotal: toNum(r.grandTotal),
    transactionCount: r.transactionCount,
    incomeExpenseTotal: toNum(r.incomeExpenseTotal),
    departmentLines: r.departmentLines.map((l) => ({
      departmentName: l.departmentName,
      amount: Number(l.amount),
      category: l.category,
    })),
    vatLines: r.vatLines.map((l) => ({
      vatCode: l.vatCode,
      salesExVat: Number(l.salesExVat),
      vat: Number(l.vat),
      salesInVat: Number(l.salesInVat),
    })),
    voidLines: r.voidLines.map((l) => ({ type: l.type, occurredAt: l.occurredAt, amount: Number(l.amount) })),
    productLines: r.productLines.map((l) => ({
      departmentName: l.departmentName,
      productName: l.productName,
      salesQuantity: l.salesQuantity,
    })),
  };
}

/**
 * Loads the DAY X-Report(s), NIGHT X-Report(s) and Z-Report(s) for
 * `businessDate` (with every child line-item table) and runs the full
 * POS-internal consistency check. This is purely additive/read-only — see
 * the module doc comment for how this differs from
 * lib/shiftReconciliation.ts's till-vs-staff check, which this never
 * touches.
 */
export async function reconcileDay(businessDate: Date): Promise<ReconcileDayResult> {
  const d = dateOnly(businessDate);

  const [dayXReports, nightXReports, zReports, dayClosed, nightClosed] = await Promise.all([
    prisma.tillReport.findMany({
      where: { businessDate: d, reportType: TillReportType.X_REPORT, shift: Shift.DAY },
      include: CHILD_INCLUDE,
      orderBy: { printedAt: "asc" },
    }),
    prisma.tillReport.findMany({
      where: { businessDate: d, reportType: TillReportType.X_REPORT, shift: Shift.NIGHT },
      include: CHILD_INCLUDE,
      orderBy: { printedAt: "asc" },
    }),
    // Same "latest print is authoritative" rule as getZReport — a Z-Report
    // is one end-of-day total, not something reprints add together.
    prisma.tillReport.findMany({
      where: { businessDate: d, reportType: TillReportType.Z_REPORT },
      include: CHILD_INCLUDE,
      orderBy: { printedAt: "desc" },
    }),
    // Live on every call, same as every other lock/closure check in this
    // app — reopening a closure or closing an already-reported shift takes
    // effect on the very next read, with no cache to invalidate.
    isShiftClosed(d, Shift.DAY),
    isShiftClosed(d, Shift.NIGHT),
  ]);

  const zReport = zReports.length > 0 ? toRawReport(zReports[0]) : null;

  return reconcileDayFromReports({
    businessDate: d,
    dayXReports: dayXReports.map(toRawReport),
    nightXReports: nightXReports.map(toRawReport),
    zReport,
    zReportCount: zReports.length,
    dayClosed,
    nightClosed,
  });
}
