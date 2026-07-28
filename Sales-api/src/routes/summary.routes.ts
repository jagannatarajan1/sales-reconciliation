import { Router } from "express";
import * as gmailService from "../services/gmail.service.js";

export const summaryRouter = Router();

summaryRouter.get("/today", (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  // TODO(commit-feature): no "Commit Day" data model exists yet, so this always
  // reports not-committed until that feature is built.
  res.json({ isCommitted: false });
});

async function getZReportForDate(targetDate: Date) {
  return gmailService.findZReportEmail(targetDate);
}

summaryRouter.get("/zreport-email", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const targetDate = new Date();
  const email = await getZReportForDate(targetDate);
  if (!email) {
    return res.status(400).json({ message: "No Z-report email found for this date." });
  }

  res.json({ isCommitted: false, targetDate, email });
});

summaryRouter.get("/zreport-email/by-date", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const targetDate = new Date(req.query.date as string);
  const email = await getZReportForDate(targetDate);
  if (!email) {
    return res.status(400).json({ message: "No Z-report email found for this date." });
  }

  res.json({ isCommitted: false, targetDate, email });
});
