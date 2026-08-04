import * as gmailService from "../services/gmail.service.js";

const VARIANCE_TOLERANCE = 5;

export interface CommitEmailInput {
  dateStr: string;
  summaryTotal: number;
  zReportTotal: number;
  difference: number;
  adminNotes?: string | null;
  staffNotes?: string | null;
}

function shopName(): string {
  return process.env.SHOP_NAME ?? "Your Shop";
}

function adminLink(): string {
  const base = process.env.GMAIL_FRONTEND_BASE_URL ?? "https://sales-reconciliation-theta.vercel.app";
  return `${base}/admin/reconciliation`;
}

function fmtGBP(value: number): string {
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Minimal HTML-escaping for the handful of values that come from free-text
// user input (staff/admin notes) rather than numbers or our own strings.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A label-over-value row, table-based like the rest of this email — the
// only layout mechanism that renders consistently across Outlook (which
// uses Word's HTML engine, not a browser one), Gmail, and Apple Mail.
function fieldRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:14px 28px;border-bottom:1px solid #eef0f4;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#9aa1b2;margin-bottom:4px;">${label}</div>
        <div style="font-size:16px;font-weight:600;color:#1f2430;">${value}</div>
      </td>
    </tr>`;
}

function notesBlock(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:14px 28px 0;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#9aa1b2;margin-bottom:6px;">${label}</div>
        <div style="font-size:14px;line-height:1.5;color:#3f4557;background:#f7f8fb;border:1px solid #eef0f4;border-radius:8px;padding:12px 14px;">${escapeHtml(value)}</div>
      </td>
    </tr>`;
}

function buildHtml(input: CommitEmailInput, isOk: boolean): string {
  const heading = isOk ? "Reconciliation Committed Successfully" : "Reconciliation Requires Admin Review";
  const accent = isOk ? "#16a34a" : "#dc2626";
  const accentBg = isOk ? "#f0fdf4" : "#fef2f2";
  const statusText = isOk ? "Committed" : "Requires Admin Review";
  const statusSub = isOk
    ? "Summary and Z-Report totals are within the £5.00 tolerance."
    : "Variance exceeds the £5.00 tolerance.";

  const rows = [
    fieldRow("Store Name", escapeHtml(shopName())),
    fieldRow("Business Date", input.dateStr),
    fieldRow("Staff Total", fmtGBP(input.summaryTotal)),
    fieldRow("Z-Report Total", fmtGBP(input.zReportTotal)),
    fieldRow("Variance", fmtGBP(input.difference)),
  ].join("");

  const statusRow = `
    <tr>
      <td style="padding:18px 28px;">
        <div style="border-radius:10px;background:${accentBg};border:1px solid ${accent}33;padding:16px 18px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${accent};margin-bottom:4px;">Status</div>
          <div style="font-size:17px;font-weight:700;color:${accent};margin-bottom:2px;">${statusText}</div>
          <div style="font-size:13px;color:#5b6172;">${statusSub}</div>
        </div>
      </td>
    </tr>`;

  const notesRows = [
    input.staffNotes ? notesBlock("Staff Notes", input.staffNotes) : "",
    input.adminNotes ? notesBlock("Admin Notes", input.adminNotes) : "",
  ].join("");

  const buttonRow = !isOk
    ? `
    <tr>
      <td style="padding:24px 28px 8px;text-align:center;">
        <div style="font-size:13px;color:#5b6172;margin-bottom:12px;">Review this reconciliation</div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td style="border-radius:8px;background:${accent};">
              <a href="${adminLink()}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">
                Review Reconciliation
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:0;background:#f2f3f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(15,17,26,0.06);">
            <tr>
              <td style="padding:26px 28px 18px;border-bottom:1px solid #eef0f4;">
                <div style="font-size:20px;font-weight:800;color:#1f2430;">${heading}</div>
              </td>
            </tr>
            ${rows}
            ${statusRow}
            ${notesRows}
            ${buttonRow}
            <tr>
              <td style="padding:22px 28px 26px;border-top:1px solid #eef0f4;">
                <div style="font-size:12px;color:#9aa1b2;">Regards,<br />Sales Reconciliation System</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendCommitNotificationEmail(input: CommitEmailInput): Promise<void> {
  const to = process.env.COMMIT_NOTIFICATION_EMAIL;
  if (!to) return;

  const isOk = input.difference <= VARIANCE_TOLERANCE;
  const subject = `Reconciliation ${isOk ? "Committed" : "Requires Admin Review"} | ${shopName()} | ${input.dateStr}`;
  const html = buildHtml(input, isOk);

  try {
    await gmailService.sendEmail(to, subject, html, { html: true });
  } catch {
    // Best-effort notification — never let an email failure break a commit.
  }
}
