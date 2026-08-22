import { Shift, TillReport, TillReportType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { dateOnly, classifyShift } from "./activeDate.js";
import { parseTillReport } from "./tillReportParser.js";
import * as gmailService from "../services/gmail.service.js";

export interface IngestResult {
  scanned: number;
  created: number;
  skipped: number;
  failed: number;
  affected: Array<{ date: Date; shift: Shift }>;
}

// Scans [from, to) for till report emails and persists any not already in
// TillReport (keyed on gmailMessageId — re-ingesting the same inbox window
// is always a safe no-op). A message that can't be classified (no report
// type, no businessDate, or no printed time — none of which are optional
// columns on TillReport) is counted as `failed` and left unpersisted rather
// than stored with guessed values; it will be picked up again on the next
// scan and is visible via the /:date/parsed diagnostic endpoint in the
// meantime.
export async function ingestTillReports(from: Date, to: Date): Promise<IngestResult> {
  const messages = await gmailService.listTillReportEmails(from, to);

  const existingIds = new Set(
    (
      await prisma.tillReport.findMany({
        where: { gmailMessageId: { in: messages.map((m) => m.gmailMessageId) } },
        select: { gmailMessageId: true },
      })
    ).map((r) => r.gmailMessageId)
  );

  const result: IngestResult = { scanned: messages.length, created: 0, skipped: 0, failed: 0, affected: [] };

  for (const message of messages) {
    if (existingIds.has(message.gmailMessageId)) {
      result.skipped++;
      continue;
    }

    const parsed = parseTillReport(message.body, message.subject);
    if (parsed.reportType == null || parsed.businessDate == null || parsed.printedAt == null || parsed.printedMinutes == null) {
      result.failed++;
      console.warn(
        `[tillReportIngest] could not classify message ${message.gmailMessageId} ` +
          `(subject=${JSON.stringify(message.subject)}): ${parsed.parseError ?? "missing required fields"}`
      );
      continue;
    }

    const shift = classifyShift(parsed.printedMinutes);

    await prisma.tillReport.create({
      data: {
        gmailMessageId: message.gmailMessageId,
        reportType: parsed.reportType as TillReportType,
        businessDate: dateOnly(parsed.businessDate),
        printedAt: parsed.printedAt,
        printedMinutes: parsed.printedMinutes,
        shift,
        reportRef: parsed.reportRef,
        departmentTotal: parsed.departmentTotal,
        grandTotal: parsed.grandTotal,
        cashTotal: parsed.tender.cash,
        cardTotal: parsed.tender.card,
        manualCardTotal: parsed.tender.manualCard,
        transactionCount: parsed.transactionCount,
        incomeExpenseTotal: parsed.incomeExpenseTotal,
        emailReceivedAt: message.receivedAt,
        emailSubject: message.subject,
        rawBody: message.body,
        parseNotes: parsed.parseError,
        // Detailed child rows added in phase 1 of the richer-parsing work.
        // Created in the same operation as the parent row (Prisma nests
        // these into one transaction) so a TillReport is never persisted
        // half-populated. Every list here defaults to [] when its section
        // couldn't be parsed (see tillReportParser.ts), so `create: []` is a
        // safe, valid no-op rather than something needing a guard.
        departmentLines: {
          create: parsed.departmentLines.map((l) => ({
            departmentName: l.departmentName,
            amount: l.amount,
            category: l.category,
          })),
        },
        vatLines: {
          create: parsed.vatLines.map((l) => ({
            vatCode: l.vatCode,
            salesExVat: l.salesExVat,
            vat: l.vat,
            salesInVat: l.salesInVat,
          })),
        },
        incomeExpenseLines: {
          create: parsed.incomeExpenseLines.map((l) => ({ label: l.label, amount: l.amount })),
        },
        voidLines: {
          create: parsed.voidLines.map((l) => ({ type: l.type, occurredAt: l.occurredAt, amount: l.amount })),
        },
        productLines: {
          create: parsed.productLines.map((l) => ({
            departmentName: l.departmentName,
            productName: l.productName,
            salesQuantity: l.salesQuantity,
            stockValue: l.stockValue,
            stockUnavailable: l.stockUnavailable,
          })),
        },
      },
    });

    result.created++;
    result.affected.push({ date: dateOnly(parsed.businessDate), shift });
  }

  return result;
}

// Per-process throttle so ensureReportsForDate doesn't hit Gmail on every
// single request for a date whose report simply hasn't arrived yet. This is
// deliberately NOT the correctness mechanism — TillReport rows are that —
// it only bounds how often an empty/incomplete day gets rescanned. Resets on
// every deploy/restart, which is fine: worst case is one extra scan.
const lastScannedAt = new Map<string, number>();

function throttleKey(date: Date): string {
  return dateOnly(date).toISOString();
}

function isThrottled(date: Date): boolean {
  const minutes = Number(process.env.TILL_SCAN_THROTTLE_MINUTES ?? 5);
  if (minutes <= 0) return false;
  const last = lastScannedAt.get(throttleKey(date));
  return last != null && Date.now() - last < minutes * 60_000;
}

function markScanned(date: Date): void {
  lastScannedAt.set(throttleKey(date), Date.now());
}

// The caching gate every read path should call before trusting TillReport
// for a date: if a Z-Report already exists for a date before today, it's
// history and can never change — zero Gmail traffic. Otherwise, ingest
// (subject to the throttle above) so freshly-arrived reports get picked up.
export async function ensureReportsForDate(date: Date): Promise<void> {
  const target = dateOnly(date);
  const today = dateOnly(new Date());

  if (target.getTime() < today.getTime()) {
    const existingZ = await prisma.tillReport.findFirst({
      where: { businessDate: target, reportType: TillReportType.Z_REPORT },
      select: { tillReportId: true },
    });
    if (existingZ) return;
  }

  if (isThrottled(target)) return;

  const from = new Date(target);
  from.setDate(from.getDate() - 1);
  const to = new Date(target);
  to.setDate(to.getDate() + 2);

  await ingestTillReports(from, to);
  markScanned(target);
}

// A Z-Report is a single end-of-day total. If more than one exists for a
// date (a till reprint), the latest print is authoritative — unlike
// X-Reports, which sum across a shift (each X resets, see getShiftXTotal).
export async function getZReport(date: Date): Promise<TillReport | null> {
  return prisma.tillReport.findFirst({
    where: { businessDate: dateOnly(date), reportType: TillReportType.Z_REPORT },
    orderBy: { printedAt: "desc" },
  });
}

export async function getZReportTotal(date: Date): Promise<number | null> {
  const report = await getZReport(date);
  return report?.departmentTotal != null ? Number(report.departmentTotal) : null;
}

// Sums every X-Report in the shift (each X resets, so the shift's true total
// is the sum, not "latest wins" — see the plan's locked-in decision on
// X-Report behaviour). If ANY report in the shift is missing its
// departmentTotal, the aggregate is null rather than a partial sum — same
// null-never-a-guessed-0 philosophy as parseDepartmentTotal, since silently
// undercounting would read as a false "shift is short" variance.
export async function getShiftXTotal(date: Date, shift: Shift): Promise<{ total: number | null; count: number }> {
  const reports = await prisma.tillReport.findMany({
    where: { businessDate: dateOnly(date), reportType: TillReportType.X_REPORT, shift },
  });

  if (reports.length === 0) return { total: null, count: 0 };
  if (reports.some((r) => r.departmentTotal == null)) return { total: null, count: reports.length };

  const total = reports.reduce((sum, r) => sum + Number(r.departmentTotal), 0);
  return { total: Math.round(total * 100) / 100, count: reports.length };
}

export async function getDayXTotals(
  date: Date
): Promise<{ day: number | null; night: number | null; sum: number | null }> {
  const [dayResult, nightResult] = await Promise.all([
    getShiftXTotal(date, Shift.DAY),
    getShiftXTotal(date, Shift.NIGHT),
  ]);

  const sum =
    dayResult.total != null && nightResult.total != null
      ? Math.round((dayResult.total + nightResult.total) * 100) / 100
      : null;

  return { day: dayResult.total, night: nightResult.total, sum };
}
