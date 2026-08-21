// One-time bootstrap for the Gmail connection.
//
// Why this exists: GET /api/gmail/connect requires an admin session, an admin
// session requires an emailed OTP, and sending that OTP requires the gmail.send
// scope. If the stored grant is missing that scope — as it is on any connection
// authorised before gmail.send was added to buildConsentUrl — those three
// requirements form a deadlock that cannot be broken from inside the app.
//
// This mints the same signed state the route would have minted and prints the
// consent URL, so the deadlock is broken without weakening the endpoint. The
// callback that receives the code (GET /api/gmail/callback) is deliberately
// ungated already, because Google calls it, so nothing else has to change.
//
//   npm run gmail:consent            # first admin in the database
//   npm run gmail:consent -- 3       # a specific userId
//
// The printed URL is valid for 10 minutes (tryValidateSignedState's TTL) and
// grants whoever opens it access to connect a mailbox — treat it as a secret.

import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { buildConsentUrl } from "../src/services/gmail.service.js";

const prisma = new PrismaClient();

// Mirrors createSignedState in src/routes/gmail.routes.ts. Kept in step with it
// by hand: if the payload shape there changes, this must change with it or the
// callback will reject the state.
function createSignedState(adminUserId: number): string {
  const secret = process.env.JWT_SECRET ?? "";
  if (!secret) throw new Error("JWT_SECRET is not set — cannot sign the state.");

  const nonce = randomUUID().replace(/-/g, "");
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${adminUserId}.${nonce}.${timestamp}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

async function main() {
  const requested = process.argv[2] ? Number.parseInt(process.argv[2], 10) : null;

  const admin = requested
    ? await prisma.user.findUnique({ where: { userId: requested } })
    : await prisma.user.findFirst({ where: { role: "admin", isActive: true }, orderBy: { userId: "asc" } });

  if (!admin) {
    console.error(
      requested
        ? `No user with userId ${requested}.`
        : "No active admin account found. Create one before connecting Gmail."
    );
    process.exitCode = 1;
    return;
  }
  if (admin.role !== "admin") {
    console.error(`User ${admin.userId} (${admin.email}) is not an admin.`);
    process.exitCode = 1;
    return;
  }

  const redirectUri = process.env.GMAIL_REDIRECT_URI ?? "";
  if (!redirectUri) {
    console.error("GMAIL_REDIRECT_URI is not set.");
    process.exitCode = 1;
    return;
  }

  const url = buildConsentUrl(createSignedState(admin.userId));

  console.log(`
Connecting Gmail as: ${admin.name} <${admin.email}>  (userId ${admin.userId})
Redirect URI:        ${redirectUri}

The API must be running and reachable at that redirect URI before you open the
link below, or Google's callback will fail.

Open this URL in a browser and approve BOTH scopes (read and send).
It expires in 10 minutes:

${url}

On the Google consent screen, make sure the "Send email on your behalf"
permission is ticked. Approving read-only only will reproduce the exact problem
this script exists to fix.
`);
}

main()
  .catch((err) => {
    console.error("Failed to build the consent URL:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
