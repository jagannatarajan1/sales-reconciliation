import { Router } from "express";
import { dateOnly } from "../lib/activeDate.js";
import { renderZReportBillPdf } from "../lib/pdf.js";
import { getZReportStatusRange, buildZReportBillsZip } from "../lib/zReportBills.js";
import * as gmailService from "../services/gmail.service.js";
import { requirePermission } from "../lib/permissions.js";

// Z Reports admin page — browse historical Z-report emails over a date
// range, view the raw text, and download as PDF (single day or a ZIP for
// the range). Gated on the same "reports" permission as the committed-only
// Sales Reconciliation history page (Reports.jsx / reports.routes.ts) —
// they're the same conceptual admin area, so this deliberately does not
// introduce a second permission key.
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
