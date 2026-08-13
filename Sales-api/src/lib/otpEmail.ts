import * as gmailService from "../services/gmail.service.js";

function shopName(): string {
  return process.env.SHOP_NAME ?? "Your Shop";
}

// Table-based layout with inline styles throughout — the only layout
// mechanism that renders consistently across Outlook (Word's HTML engine,
// not a browser one), Gmail, and Apple Mail. Mirrors commitEmail.ts's style.
function buildHtml(code: string, expiresInMinutes: number): string {
  const spacedCode = code.split("").join(" ");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Admin Login Verification Code</title>
  </head>
  <body style="margin:0;padding:0;background:#f2f3f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(15,17,26,0.06);">
            <tr>
              <td style="padding:26px 28px 18px;border-bottom:1px solid #eef0f4;">
                <div style="font-size:20px;font-weight:800;color:#1f2430;">Admin Login Verification</div>
                <div style="font-size:13px;color:#5b6172;margin-top:4px;">${shopName()}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;text-align:center;">
                <div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#9aa1b2;margin-bottom:14px;">Your verification code</div>
                <div style="font-size:36px;font-weight:800;letter-spacing:.15em;color:#4f46e5;font-family:'Courier New',monospace;">${spacedCode}</div>
                <div style="font-size:13px;color:#5b6172;margin-top:16px;">This code expires in ${expiresInMinutes} minutes and can only be used once.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 26px;">
                <div style="border-radius:10px;background:#fffbeb;border:1px solid #fcd34d55;padding:14px 16px;font-size:13px;color:#92400e;">
                  If you did not request this code, you can safely ignore this email — no one can access your account without it.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 26px;border-top:1px solid #eef0f4;">
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

// Unlike the commit notification email, this is never best-effort — the
// caller must know whether delivery actually succeeded, since an admin
// session must not be created without it.
export async function sendOtpEmail(to: string, code: string, expiresInMinutes: number): Promise<boolean> {
  const subject = `${code} is your admin verification code | ${shopName()}`;
  return gmailService.sendEmail(to, subject, buildHtml(code, expiresInMinutes), { html: true });
}
