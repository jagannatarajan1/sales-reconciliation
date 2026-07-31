import { renderZReportBillPdf, type PdfMeta } from "./pdf.js";
import { buildZip } from "./zip.js";
import * as gmailService from "../services/gmail.service.js";

export interface ZReportStatus {
  date: string;
  found: boolean;
  receivedAt: string | null;
}

function eachDate(fromDate: Date, toDate: Date): Date[] {
  const dates: Date[] = [];
  for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(new Date(d));
  }
  return dates;
}

/** Day-by-day Z-report lookup over a range — Gmail has no native range-query
 * for "one email per day", so this walks the range and checks each date. */
export async function getZReportStatusRange(fromDate: Date, toDate: Date): Promise<ZReportStatus[]> {
  const results: ZReportStatus[] = [];
  for (const current of eachDate(fromDate, toDate)) {
    let found = false;
    let receivedAt: string | null = null;
    try {
      const email = await gmailService.findZReportEmail(current);
      if (email) {
        found = true;
        receivedAt = email.date.toISOString();
      }
    } catch {
      // Best-effort — treat as not found rather than failing the whole range.
    }
    results.push({ date: current.toISOString().split("T")[0], found, receivedAt });
  }
  return results;
}

/** Builds a ZIP of one Z-report bill PDF per date in the range that actually
 * has an email. Returns null if none of the dates had an email. Shared by
 * both the admin-reconciliation "Download Bill" tool and the Z Reports page
 * so the per-day render/zip logic exists in exactly one place. */
export async function buildZReportBillsZip(fromDate: Date, toDate: Date, meta: PdfMeta = {}): Promise<Buffer | null> {
  const files: Array<{ name: string; content: Buffer }> = [];
  for (const current of eachDate(fromDate, toDate)) {
    const email = await gmailService.findZReportEmail(current);
    if (!email) continue;

    const pdf = await renderZReportBillPdf(current, email.body, meta);
    files.push({ name: `zreport-bill-${current.toISOString().split("T")[0]}.pdf`, content: pdf });
  }

  if (files.length === 0) return null;
  return buildZip(files);
}
