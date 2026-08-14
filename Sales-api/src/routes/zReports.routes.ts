import { Router } from "express";
import { dateOnly } from "../lib/activeDate.js";
import { renderZReportBillPdf } from "../lib/pdf.js";
import { getZReportStatusRange, buildZReportBillsZip } from "../lib/zReportBills.js";
import * as gmailService from "../services/gmail.service.js";
import { parseTillReport } from "../lib/tillReportParser.js";
import { requirePermission } from "../lib/permissions.js";

// Z Reports admin page — browse historical Z-report emails over a date
// range, view the raw text, and download as PDF (single day or a ZIP for
// the range). Admin-only behind the "reports" permission. Sales
// Reconciliation/"Download Bill" lives entirely in adminReconciliation.routes.ts
// (gated on "commitHistory") — there is no separate reports.routes.ts.
export const zReportsRouter = Router();

function requireReports(req: import("express").Request, res: import("express").Response): boolean {
  return requirePermission(req, res, "reports");
}

zReportsRouter.get("/", async (req, res) => {
  if (!requireReports(req, res)) return;

  const fromParam = req.query.fromDate as string | undefined;
  const toParam = req.query.toDate as string | undefined;
  if (!fromParam || !toParam) return res.status(400).json({ message: "fromDate and toDate query parameters are required." });

  const fromDate = dateOnly(fromParam);
  const toDate = dateOnly(toParam);
  if (fromDate > toDate) return res.status(400).json({ message: "fromDate must be on or before toDate." });

  const items = await getZReportStatusRange(fromDate, toDate);
  res.json({ items });
});

zReportsRouter.get("/download-pdf-range", async (req, res) => {
  if (!requireReports(req, res)) return;

  const fromParam = req.query.fromDate as string | undefined;
  const toParam = req.query.toDate as string | undefined;
  if (!fromParam || !toParam) return res.status(400).json({ message: "fromDate and toDate query parameters are required." });

  const fromDate = dateOnly(fromParam);
  const toDate = dateOnly(toParam);

  const zip = await buildZReportBillsZip(fromDate, toDate, { generatedByName: req.userName });
  if (!zip) return res.status(400).json({ message: "No Z-report emails found for this range." });

  const fromStr = fromDate.toISOString().split("T")[0];
  const toStr = toDate.toISOString().split("T")[0];
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="zreports-${fromStr}-to-${toStr}.zip"`);
  res.send(zip);
});

zReportsRouter.get("/:date", async (req, res) => {
  if (!requireReports(req, res)) return;

  const date = dateOnly(req.params.date);
  const email = await gmailService.findZReportEmail(date);

  res.json({
    date: date.toISOString().split("T")[0],
    found: !!email,
    receivedAt: email?.date.toISOString() ?? null,
    body: email?.body ?? null,
  });
});

// Diagnostic: shows every till email around this date and how the parser
// reads each one, so a human can eyeball real inbox data against
// tillReportParser.ts's output — e.g. to check a subject/type mismatch or a
// header/Date: field disagreement before it ever affects reconciliation.
zReportsRouter.get("/:date/parsed", async (req, res) => {
  if (!requireReports(req, res)) return;

  const target = dateOnly(req.params.date);
  const after = new Date(target);
  after.setDate(after.getDate() - 1);
  const before = new Date(target);
  before.setDate(before.getDate() + 2);

  const messages = await gmailService.listTillReportEmails(after, before);
  const parsed = messages.map((m) => ({
    gmailMessageId: m.gmailMessageId,
    subject: m.subject,
    receivedAt: m.receivedAt.toISOString(),
    ...parseTillReport(m.body, m.subject),
  }));

  const selectedZReport = await gmailService.findZReportEmail(target);

  res.json({
    date: target.toISOString().split("T")[0],
    windowFrom: after.toISOString().split("T")[0],
    windowTo: before.toISOString().split("T")[0],
    messages: parsed,
    selectedZReportReceivedAt: selectedZReport?.date.toISOString() ?? null,
  });
});

zReportsRouter.get("/:date/download-pdf", async (req, res) => {
  if (!requireReports(req, res)) return;

  const date = dateOnly(req.params.date);
  const email = await gmailService.findZReportEmail(date);
  if (!email) return res.status(400).json({ message: "No Z-report email found for this date." });

  const pdf = await renderZReportBillPdf(date, email.body, { generatedByName: req.userName });
  const dateStr = date.toISOString().split("T")[0];
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="zreport-bill-${dateStr}.pdf"`);
  res.send(pdf);
});
