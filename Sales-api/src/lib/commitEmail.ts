import * as gmailService from "../services/gmail.service.js";

const VARIANCE_TOLERANCE = 5;

export interface CommitEmailInput {
  dateStr: string;
  summaryTotal: number;
  zReportTotal: number;
  difference: number;
  adminNotes?: string | null;
  staffName?: string | null;
  shift?: string | null;
  staffNotes?: string | null;
}

function shopName(): string {
  return process.env.SHOP_NAME ?? "Your Shop";
}

function adminLink(): string {
  const base = process.env.GMAIL_FRONTEND_BASE_URL ?? "";
  return `${base}/admin/reconciliation`;
}

export async function sendCommitNotificationEmail(input: CommitEmailInput): Promise<void> {
  const to = process.env.COMMIT_NOTIFICATION_EMAIL;
  if (!to) return;

  const isOk = input.difference <= VARIANCE_TOLERANCE;
  const status = isOk ? "Successful — within £5.00 tolerance" : "Requires Admin Review — exceeds £5.00 tolerance";

  const lines = [
    `Store: ${shopName()}`,
    `Date: ${input.dateStr}`,
    ...(input.staffName ? [`Staff Name: ${input.staffName}`] : []),
    ...(input.shift ? [`Shift: ${input.shift}`] : []),
    `Staff Total: £${input.summaryTotal.toFixed(2)}`,
    `Z-Report Total: £${input.zReportTotal.toFixed(2)}`,
    `Variance: £${input.difference.toFixed(2)}`,
    `Status: ${status}`,
  ];

  if (input.staffNotes) {
    lines.push("", `Staff Notes: ${input.staffNotes}`);
  }

  if (!isOk) {
    lines.push("");
    if (input.adminNotes) lines.push(`Notes: ${input.adminNotes}`);
    lines.push(`Review this reconciliation: ${adminLink()}`);
  }

  const subject = `Reconciliation ${isOk ? "Committed" : "Needs Review"} — ${shopName()} — ${input.dateStr}`;

  try {
    await gmailService.sendEmail(to, subject, lines.join("\n"));
  } catch {
    // Best-effort notification — never let an email failure break a commit.
  }
}
