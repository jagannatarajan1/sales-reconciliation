import PDFDocument from "pdfkit";
import type { ReconciliationRecord } from "@prisma/client";

function fmtGBP(value: unknown): string {
  const n = Number(value ?? 0);
  return `£${n.toFixed(2)}`;
}

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export async function renderReconciliationReportPdf(record: ReconciliationRecord): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50 });
  const dateStr = record.date.toISOString().split("T")[0];

  doc.fontSize(18).text(`Reconciliation Report — ${dateStr}`, { underline: true });
  doc.moveDown();

  doc.fontSize(10).fillColor("#555");
  if (record.committedByName) doc.text(`Committed by: ${record.committedByName}${record.committedAt ? " on " + record.committedAt.toLocaleString("en-GB") : ""}`);
  if (record.adminSubmittedByName) doc.text(`Admin reviewed by: ${record.adminSubmittedByName}${record.adminSubmittedAt ? " on " + record.adminSubmittedAt.toLocaleString("en-GB") : ""}`);
  doc.fillColor("#000");
  doc.moveDown();

  const section = (title: string, rows: Array<[string, string]>) => {
    doc.fontSize(13).text(title);
    doc.fontSize(11);
    for (const [label, value] of rows) {
      doc.text(`${label}: ${value}`);
    }
    doc.moveDown(0.5);
  };

  section("Credit Card", [
    ["Manual Card Amount", fmtGBP(record.manualCardAmount)],
    ["Card Amount", fmtGBP(record.cardAmount)],
  ]);
  section("Cash", [
    ["Last Safe", fmtGBP(record.lastSafe)],
    ["Safe Drop Amount", fmtGBP(record.safeDropAmount)],
  ]);
  section("Deductions", [
    ["Cashback", fmtGBP(record.cashback)],
    ["Paypoint Payout", fmtGBP(record.paypointPayout)],
    ["Instant Lottery Payout", fmtGBP(record.instantLotteryPayout)],
    ["Lottery Payout", fmtGBP(record.lotteryPayout)],
    ["News Voucher", fmtGBP(record.newsVoucher)],
    ["DD Point", fmtGBP(record.ddPoint)],
  ]);
  section("Supplier Payout", [["Supplier Payout", fmtGBP(record.supplierInvoicesTotal)]]);
  section("Instant Lottery", [
    ["Total Count", String(record.instantLotteryTotalCount)],
    ["Total Sales", fmtGBP(record.instantLotteryTotalSales)],
  ]);
  section("Lottery", [["Lottery Value", fmtGBP(record.lotteryValue)]]);
  section("Paypoint", [["Paypoint Value", fmtGBP(record.paypointValue)]]);

  doc.fontSize(13).text("Totals");
  doc.fontSize(11);
  doc.text(`Summary Total: ${fmtGBP(record.summaryTotal)}`);
  doc.text(`Z-Report Total: ${fmtGBP(record.zReportTotal)}`);
  doc.text(`Difference: ${fmtGBP(record.difference)}`);

  if (record.adminNotes) {
    doc.moveDown();
    doc.fontSize(13).text("Admin Notes");
    doc.fontSize(11).text(record.adminNotes);
  }

  return collectPdf(doc);
}

export async function renderZReportBillPdf(date: Date, emailBody: string | null): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50 });
  const dateStr = date.toISOString().split("T")[0];

  doc.fontSize(18).text(`Z-Report Bill — ${dateStr}`, { underline: true });
  doc.moveDown();

  doc.font("Courier").fontSize(10);
  doc.text(emailBody ?? "No Z-report email found for this date.");

  return collectPdf(doc);
}
