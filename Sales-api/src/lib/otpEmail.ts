import * as gmailService from "../services/gmail.service.js";

function shopName(): string {
  return process.env.SHOP_NAME ?? "Your Shop";
}

// Table-based layout with inline styles throughout — the only layout
// mechanism that renders consistently across Outlook (Word's HTML engine,
// not a browser one), Gmail, and Apple Mail. Mirrors commitEmail.ts's style.
//
// The OTP itself is rendered as one unbroken text run styled with
// `letter-spacing` for visual separation — not joined with literal spaces —
// so selecting/copying the code yields the exact 6 digits, nothing else.
function buildHtml(code: string, expiresInMinutes: number): string {
  const shop = shopName();
  const year = new Date().getFullYear();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <title>Verify It's You</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <!-- Preheader: shown in inbox preview text, hidden in the body. No OTP here on purpose. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
      Your verification code expires in ${expiresInMinutes} minutes. Use it to finish signing in to ${shop}.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f3f4f6;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:48px 20px;">

          <!-- Card -->
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 1px 3px rgba(16,24,40,0.05);">

            <!-- Brand header -->
            <tr>
              <td style="padding:32px 40px 24px;border-bottom:1px solid #eef0f3;">
                <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#374151;">${shop}</span>
              </td>
            </tr>

            <!-- Heading + explanation -->
            <tr>
              <td style="padding:36px 40px 4px;text-align:center;">
                <h1 style="margin:0;padding:0;font-size:22px;line-height:30px;font-weight:700;color:#111827;">Verify It's You</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 40px 0;text-align:center;">
                <p style="margin:0;padding:0;font-size:15px;line-height:23px;color:#565f72;">
                  Use the verification code below to complete your sign-in.
                </p>
              </td>
            </tr>

            <!-- OTP -->
            <tr>
              <td style="padding:28px 40px 0;text-align:center;">
                <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                  <tr>
                    <td style="padding:16px 30px;background-color:#f5f3ff;border:1px solid #e4defc;border-radius:10px;">
                      <span style="display:inline-block;font-family:'Courier New',Courier,monospace;font-size:34px;line-height:40px;font-weight:700;letter-spacing:10px;color:#4f46e5;white-space:nowrap;">${code}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 40px 0;text-align:center;">
                <p style="margin:0;padding:0;font-size:13px;line-height:20px;color:#6b7280;">
                  This code expires in <strong style="color:#374151;">${expiresInMinutes} minutes</strong> and can only be used once.
                </p>
              </td>
            </tr>

            <!-- Security note -->
            <tr>
              <td style="padding:32px 40px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid #eef0f3;">
                  <tr>
                    <td style="padding:20px 0 0;">
                      <p style="margin:0;padding:0;font-size:13px;line-height:20px;color:#6b7280;">
                        If you didn't request this code, you can safely ignore this email — no one can access your account without it.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:28px 40px 32px;">
                <p style="margin:0;padding:0;font-size:12px;line-height:18px;color:#9aa1b2;">
                  This is an automated message from ${shop}. Please don't reply to this email.
                </p>
                <p style="margin:8px 0 0;padding:0;font-size:12px;line-height:18px;color:#9aa1b2;">
                  &copy; ${year} ${shop}. All rights reserved.
                </p>
              </td>
            </tr>

          </table>
          <!-- /Card -->

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
