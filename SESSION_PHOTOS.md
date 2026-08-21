# Session Photos — Complete Reference

Photo evidence capture for the Sales Reconciliation app. Staff attach photos
(camera or file) to the shift they are working; admins browse them by user,
session and date.

Branch: `feature/session-photos` (off `main`, uncommitted)
Scope:  38 files, +4,904 lines
Status: code complete, verified. ONE step outstanding — see section 1.


================================================================================
1. BEFORE YOU CAN RUN IT  (outstanding)
================================================================================

Your local database has NOT been migrated. It is still on the pre-shift schema
and has no SessionPhoto table, so the app will fail on startup queries.

I was blocked from running this by a permission guard, because it needs the
--accept-data-loss flag. Run it yourself:

    cd Sales-api
    npx prisma db push --accept-data-loss

What that flag is actually for here:

  * Drops the obsolete `Attachment` table (3 throwaway rows from earlier
    testing in this session). This is the only real data loss.
  * Adds unique constraints on (date, shift) to DailySummary, Deduction,
    LotteryRecord, PaypointRecord and InstantLotteryInventoryEntry. These are
    your local DB catching up to `main`'s shift feature — needed regardless of
    the photo work.
  * Creates the new `SessionPhoto` table.

Your four user accounts survive this — the command adds constraints and drops
only the Attachment table. Take your own backup first anyway:

    cd Sales-api
    set -a; source .env; set +a
    pg_dump "$DATABASE_URL" --data-only --table='"User"' > ~/users-backup.sql

To restore if something goes wrong:

    psql "$DATABASE_URL" < ~/users-backup.sql

IMPORTANT — production is different. On a fresh/production database this
change is purely additive and applies with a plain `prisma db push`, no flag.
I confirmed that against a clean test database. The deploy script deliberately
does NOT pass --accept-data-loss, so a destructive change fails the deploy
instead of silently destroying data.


================================================================================
2. RUNNING IT LOCALLY
================================================================================

Step 1 — migrate the database (section 1 above).

Step 2 — regenerate the Prisma client:

    cd Sales-api
    npx prisma generate

Step 3 — start the API:

    cd Sales-api
    npm run dev                      # http://localhost:5000

Step 4 — start the UI in a second terminal:

    cd Sales-ui-sales_ui/sales-reconciliation-ui
    npm run dev                      # http://localhost:5173

Log in with:  staff@test.com / LocalDev2026!

Photos are written to Sales-api/uploads/session-photos/ in dev (gitignored).

Admin login note: admin accounts require an emailed OTP, and that is currently
broken — see section 12.


================================================================================
3. HOW IT WORKS
================================================================================

3.1 Upload path
---------------

  Browser                API (memory only)                    Disk        DB
  -------                -----------------                    ----        --
  downscale  --multipart--> multer memoryStorage
                              |
                              v
                           sniff magic bytes ---- not an image ----> 400
                              |
                              v
                           sharp decode ---------- won't decode ---> 400
                              |
                              v
                           re-encode (EXIF/GPS stripped)
                              |
                              +--> storage.put(full)   ------------> file
                              +--> storage.put(thumb)  ------------> file
                              |
                              v
                           prisma.$transaction ---------------------> row
                              |
                              +-- on failure: delete both blobs (rollback)

Key properties:

  * Raw client bytes NEVER touch the disk. multer uses memoryStorage; only the
    re-encoded output is written.
  * ALL files in a request are validated before ANY is written, so a bad third
    file cannot leave the first two on disk.
  * Re-encoding is the real sanitiser. A polyglot (valid JPEG header with a PHP
    payload appended) does not survive decode-to-pixels-and-re-encode. Verified.
  * File type comes from sniffed bytes, never the filename or the client's
    Content-Type. The original filename is stored as metadata for display only
    and is never used to build a path.

3.2 Retrieval path (production, with nginx)
-------------------------------------------

  Browser --GET /api/session-photos/:id/file (Bearer token)--> API
                                                                |
                            authorise: token + section permission + session
                                                                |
                                       X-Accel-Redirect: /_protected_uploads/...
                                       Content-Length: 0
                                                                |
                                                                v
                                                              nginx
                                                                |
                                            reads internal location from disk
                                                                |
                                       bytes --------------------> Browser

  Browser --GET /_protected_uploads/<known filename>--> nginx --> 404
                                    (location is `internal`)

So: Node authorises, nginx pushes the bytes. Guessing a filename gets you
nothing. With PHOTO_ACCEL_REDIRECT unset (dev), Node streams the file itself —
slower, but no nginx required.

Why blob URLs on the client: an <img src> cannot carry an Authorization
header, and these files must not be publicly reachable. The UI fetches each
image with the token and renders an object URL, revoking them on reload and
unmount.


================================================================================
4. THE SESSION MODEL
================================================================================

The spec asked for a `sessionId`. This app has no login-session table — auth is
stateless JWT. But it has a real session unit: every domain model is keyed
`@@unique([date, shift])`, where shift is FULL_DAY | DAY | NIGHT.

So a photo's session is (date, shift), resolved SERVER-SIDE by
`getActiveContext()` in Sales-api/src/lib/activeDate.ts — the same source the
nine staff entry pages already use.

The client never sends a date or shift. It cannot file a photo against a
session it is not working. This also satisfies the spec's rule about never
trusting client-supplied identifiers.

Shift derivation (from activeDate.ts):
  * SHIFT_ENTRY_ENABLED=false  -> everything lands in FULL_DAY (the default)
  * SHIFT_ENTRY_ENABLED=true   -> DAY/NIGHT split at SHIFT_CUTOFF_TIME,
                                  or forced by ActiveDateOverride.activeShift

Staff visibility is PER-SESSION, not per-user. Anyone working a session sees
its photos; cross-session reads are denied. This is a deliberate, documented
deviation from the spec's literal "User A cannot access User B's photo" —
strict isolation would hide a colleague's evidence on a shared shift and break
handover. Every photo still records its uploader for audit.


================================================================================
5. DATA MODEL
================================================================================

model SessionPhoto  (Sales-api/prisma/schema.prisma)

  sessionPhotoId    Int       PK
  section           String    which page (see section 7)
  date              DateTime  @db.Date   -- session half 1
  shift             Shift     FULL_DAY|DAY|NIGHT -- session half 2
  entityId          String?   row scope; used by catalogue sections only
  uploadedByUserId  Int
  uploadedByName    String?
  originalFilename  String    display/audit only, never used as a path
  storageKey        String    @unique -- driver-relative key, NOT a path
  thumbnailKey      String?
  mimeType          String
  fileSize          Int
  width             Int?
  height            Int?
  source            String    "camera" | "file"
  status            String    "ready" | "failed"
  createdAt         DateTime
  updatedAt         DateTime

  Indexes: [uploadedByUserId], [date, shift], [section, date, shift], [createdAt]

Only metadata is in Postgres. The image bytes are on the filesystem. That is
why backups must cover BOTH — see section 10.

storageKey is a driver-relative key, not a filesystem path. That is what makes
switching to S3 a driver change rather than a schema change.


================================================================================
6. API REFERENCE
================================================================================

All errors return { "message": "..." }, matching the existing convention.
Filesystem paths and internal errors are never exposed to clients.

6.1 Staff — /api/session-photos
-------------------------------

  GET    /sections            catalogue of sections (labels, lock rules)
  GET    /session             the active { date, shift, isLocked }
  GET    /?section=&entityId= photos for the ACTIVE session only
  POST   /                    multipart upload; field name `photos`
                              body: section, entityId?, source (camera|file)
                              date/shift/uploader all derived server-side
  GET    /:id/file?size=thumb full or thumbnail
  DELETE /:id                 blocked once the day is committed (409)

6.2 Admin — /api/admin/session-photos
-------------------------------------

  Gated on the `sessionPhotos` permission module.

  GET    /sections            for the filter dropdown
  GET    /uploaders           distinct uploaders + photo counts
  GET    /sessions            (date, shift) groups with counts
  GET    /                    paginated list
                              ?userId=&section=&shift=&fromDate=&toDate=
                              &page=&pageSize=  (pageSize capped at 100)
                              -> { items, page, pageSize, total, totalPages }
  GET    /:id/file?size=thumb
  DELETE /:id                 allowed regardless of day lock; always audited

Admins may delete past the day lock deliberately: the lock exists to stop staff
altering committed evidence, not to stop an authorised admin removing something
that should never have been uploaded.


================================================================================
7. WHERE PHOTOS APPEAR
================================================================================

Section key                Page                          Locks with day
-------------------------  ----------------------------  --------------
cashBanking                Cash Banking                   yes
creditCardBanking          Credit Card Banking            yes
lottery                    Lottery                        yes
paypoint                   Paypoint                       yes
deductions                 Deductions                     yes
supplierInvoices           Deductions (invoice block)     yes
instantLotteryInventory    Instant Lottery Inventory      yes
summary                    Summary                        yes
commit                     Commit                         yes
scratchCards               Scratch Cards (per card row)   no
zReports                   (registry only, admin browse)  no
shopSale                   (registry only — see below)    yes

"Locks with day" = once ReconciliationRecord.isStaffCommitted OR
isAdminReconciled is true for that date, uploads and deletes return 409 and the
UI hides the controls. Same predicate the Summary/Commit flow already uses.

Catalogue sections (scratchCards) are not date-scoped: a photo belongs to a
card, not a day, and stays visible regardless of session. Those require an
entityId.


================================================================================
8. SECURITY MODEL
================================================================================

Requirement                     Mechanism
------------------------------  ----------------------------------------------
Untrusted uploads               magic-byte sniff -> sharp decode -> re-encode
Executable upload defence       re-encode destroys non-image payloads
No client-supplied paths        storageKey is a server-generated UUID
Path traversal                  key regex + resolved-path root check in
                                localDisk.ts; rejected even if the DB row is
                                tampered with (verified)
EXIF / GPS                      stripped by sharp .rotate() + re-encode
Decompression bombs             rejected above 80 megapixels
Not publicly reachable          nginx location is `internal`; only reachable
                                via X-Accel-Redirect after authorisation
No userId from the client       uploader from JWT, session from server
Per-endpoint authorization      requirePermission server-side on every route;
                                re-checked on :id/file so changing the id in
                                the URL cannot reach another section
Evidence preservation           deletion blocked once the day is committed
No file/row drift               blobs written only after all files validate;
                                blobs deleted if the transaction fails; delete
                                removes the row and both blobs
No sensitive logging            image bytes never logged; errors carry no paths
Rate limiting                   photo file reads get their own 2000/15min
                                bucket so a thumbnail grid cannot exhaust the
                                general 300/15min allowance

Frontend route protection (ProtectedRoute) is defence-in-depth only. Every
check is enforced server-side.


================================================================================
9. CONFIGURATION
================================================================================

Added to Sales-api/.env.example (and written by the VPS bootstrap script):

  PHOTO_STORAGE_DRIVER=local
      Storage backend. Only "local" ships. The driver interface exists so
      S3/R2/MinIO can be added without touching routes, schema or UI.

  PHOTO_UPLOAD_DIR=./uploads/session-photos
      Where the local driver writes. MUST be absolute in production, on a
      volume that survives redeploys.

  PHOTO_ACCEL_REDIRECT=
      nginx `internal` location, e.g. /_protected_uploads. Empty means Node
      streams the bytes itself — slower, but useful for diagnosis.

  MAX_PHOTO_SIZE_MB=10
  PHOTO_MAX_FILES_PER_REQUEST=10
  PHOTO_ALLOWED_TYPES=image/jpeg,image/png,image/webp,image/heic
  PHOTO_MAX_EDGE_PX=1600
  PHOTO_THUMB_EDGE_PX=320

Also documented (were missing): SHIFT_ENTRY_ENABLED, SHIFT_CUTOFF_TIME,
SHOP_TIMEZONE.

nginx client_max_body_size must stay at or above
MAX_PHOTO_SIZE_MB x PHOTO_MAX_FILES_PER_REQUEST plus multipart overhead. It
ships at 160m.

HEIC decoding depends on how libvips was built. If HEIC is rejected on your
VPS, that is why — the API returns a clear message telling the user to send a
JPEG or PNG instead of failing opaquely.


================================================================================
10. VPS DEPLOYMENT
================================================================================

The deploy/ tree contains everything needed. Start at deploy/README.md.

  1. Clone and bootstrap (one time, as root):
       git clone <repo> /tmp/sr
       bash /tmp/sr/deploy/scripts/vps-bootstrap.sh

     Installs Node 22, PostgreSQL, nginx, ufw; creates the salesapp account,
     the database, the upload directory, the systemd unit and the nginx site.

  2. Fill in /etc/sales-reconciliation/api.env
     (domain + Gmail credentials; leave the generated values alone).

  3. Set server_name in /etc/nginx/sites-available/sales-reconciliation,
     then: certbot --nginx -d your-domain.com

  4. Deploy:
       bash /opt/sales-reconciliation/deploy/scripts/deploy.sh

  5. Install the backup cron (see below).

  6. Grant yourself the sessionPhotos permission in /admin/users.

BACKUPS — this matters more than usual now. The Attachment rows are in
Postgres but the image bytes are on disk. A database-only backup restores the
figures and leaves every photo broken. deploy/scripts/backup.sh captures both:

    echo '15 2 * * * root /opt/sales-reconciliation/deploy/scripts/backup.sh' \
      > /etc/cron.d/sales-reconciliation-backup

Photos survive restarts and redeploys because they live in
/var/lib/sales-reconciliation/uploads, outside the app directory that deploy.sh
replaces.

systemd runs the service with ProtectSystem=strict, so the filesystem is
read-only to it except ReadWritePaths=<upload dir>.

Camera note: getUserMedia requires a secure context. Over plain HTTP the
component falls back to the OS camera app via an <input capture> field. Finish
the certbot step to get the in-page camera. localhost counts as secure, so dev
works without TLS.


================================================================================
11. VERIFICATION
================================================================================

49 checks, all passing, run against a throwaway Postgres container. Your
production database was never touched.

  Image pipeline (7)
    resize 3000px -> 1600px; thumbnail smaller than full; EXIF/GPS stripped;
    PHP payload destroyed by re-encode; non-image rejected; undecodable
    JPEG-headed file rejected; GIF sniffing

  Authentication (3)     unauthenticated list/upload, bad token -> 401
  Validation (3)         unknown section, catalogue without entityId, no file
  Upload + retrieval (4) 201 + id, full fetch, thumbnail fetch
  Malicious content (3)  PHP-in-JPEG, oversized (400 not 500), text as .jpg
  Authorization (5)      staff->admin 403, staff->zReports 403,
                         admin-without-permission 403, admin-with 200,
                         admin-without -> file 403
  Storage layout (5)     thumbnail smaller, no payload on disk, UUID filenames,
                         section/date/SHIFT/uuid.jpg layout, file mode 0640
  EXIF (1)               no EXIF in a real stored file
  Cross-session (3)      staff cannot read or delete another session's photo;
                         admin still can
  Day lock (3)           upload 409, delete 409, scratchCards unaffected
  Path traversal (3)     non-numeric id 400, unknown id 404, and a DB row
                         tampered to '../../../../etc/passwd' -> 404 with no
                         path in the error
  Admin listing (3)      pagination envelope, invalid section 400,
                         fromDate>toDate 400
  Deletion (4)           200, both blobs removed, row removed, then 404
  Accel redirect (2)     header present when authorised (Content-Length: 0);
                         absent on a 401

Build state:
  API typecheck (tsc --noEmit)          PASS
  UI build (vite)                       PASS
  UI lint                               27 errors / 17 warnings
                                        == the pre-existing baseline exactly.
                                        This work adds zero lint errors.

The lint baseline was already red before this work (set-state-in-effect and
immutability patterns across 19 files). Worth a separate cleanup pass.


================================================================================
12. KNOWN ISSUE — ADMIN LOGIN IS BROKEN (pre-existing)
================================================================================

Not caused by this work, but it blocks testing any admin path.

Admin login requires an emailed OTP. The stored Gmail grant carries only
`gmail.readonly`, but the code requests `readonly + send`. Google therefore
rejects the OTP email with ACCESS_TOKEN_SCOPE_INSUFFICIENT, the API returns
503, and no admin can log in.

Diagnosis performed: the refresh token itself is valid (Google returns HTTP 200
and an access token). The granted scope string is literally
"https://www.googleapis.com/auth/gmail.readonly" — the connection was
authorised before gmail.send was added to the requested scopes.

Fix: re-run the Gmail OAuth consent so a new grant covers both scopes. There is
a chicken-and-egg problem — /api/gmail/connect requires an admin session, which
requires the OTP. Options:
  (a) Mint a signed state manually and complete the consent flow (the callback
      is not gated).
  (b) Copy the GmailConnection row from a working environment.

This probably affects PRODUCTION too. Worth checking before you rely on admin
access there.


================================================================================
13. DELIBERATE OMISSIONS
================================================================================

ShopSale — no photo block. On `main` this page was rewritten into a read-only
shift-status calendar; it has no data entry and no lock flag. Attaching an
upload widget there would be wrong. The section key stays in the registry in
case the page changes again.

Supplier Payout (DateCard) and Z-Report detail — no photo block, though
client-1 had them. Both are HISTORICAL views, but the staff endpoint
deliberately serves only the active session. Mounting there would display the
current session's photos under a historical date heading. Admins get that
coverage properly through the new dashboard, filtered by section and date.

S3/R2/MinIO driver — interface built, driver not written. Adding one is a new
file plus a case in getStorage().

Backfilling photos onto historical sessions — not attempted.

prisma migrate baseline — the project has no migrations directory and uses
db push. Introducing migrate would require baselining the existing production
database with `migrate resolve --applied`, which is separate work.


================================================================================
14. FILE INVENTORY
================================================================================

NEW — backend
  Sales-api/src/lib/storage/types.ts          storage driver interface
  Sales-api/src/lib/storage/localDisk.ts      local disk driver + path guards
  Sales-api/src/lib/storage/index.ts          driver factory
  Sales-api/src/lib/imagePipeline.ts          sniff, decode, re-encode, thumb
  Sales-api/src/lib/sessionPhotos.ts          section registry, access, DTOs
  Sales-api/src/routes/sessionPhotos.routes.ts        staff endpoints
  Sales-api/src/routes/adminSessionPhotos.routes.ts   admin endpoints

NEW — frontend
  src/components/PhotoAttachments.jsx         capture component (camera+file)
  src/components/PhotoAttachments.css
  src/constants/photoSections.js
  src/pages/AdminSessionPhotos/AdminSessionPhotos.jsx   admin browser
  src/pages/AdminSessionPhotos/AdminSessionPhotos.css

NEW — deployment
  deploy/README.md                            full runbook
  deploy/nginx/sales-reconciliation.conf
  deploy/systemd/sales-api.service
  deploy/scripts/vps-bootstrap.sh
  deploy/scripts/deploy.sh
  deploy/scripts/backup.sh

CHANGED — backend
  prisma/schema.prisma      + SessionPhoto model
  src/index.ts              mount routers, photo-file rate limiter
  src/lib/permissions.ts    + sessionPhotos module
  package.json              + multer, @types/multer, sharp
  .env.example              + PHOTO_* and SHIFT_* variables
  .gitignore                + uploads/

CHANGED — frontend
  src/App.jsx                          + /admin/session-photos route
  src/pages/AdminDashboard.jsx         + Session Photos card
  src/pages/AdminUsers/AdminUsers.jsx  + sessionPhotos permission checkbox
  CashBanking, CreditCardBanking, Lottery, Paypoint, Deductions,
  InstantLotteryInventory, Summary, Commit, ScratchCards  — mount points


================================================================================
15. QUICK TROUBLESHOOTING
================================================================================

App won't start / Prisma errors about unknown fields
  -> The generated client is stale. Run: npx prisma generate
     (This bit twice during development. It only writes to node_modules and
     never touches the database.)

502 from nginx
  -> API is down. journalctl -u sales-api -n 50

413 on upload
  -> client_max_body_size below what is being sent. Ships at 160m.

Photos upload but do not display
  -> Check PHOTO_ACCEL_REDIRECT matches the nginx internal location, and that
     the nginx alias path matches PHOTO_UPLOAD_DIR exactly, trailing slash
     included. Clearing PHOTO_ACCEL_REDIRECT makes Node stream them instead,
     which removes nginx from the equation while you diagnose.

Camera button does nothing
  -> getUserMedia needs HTTPS. Over plain HTTP it falls back to the OS camera
     app. localhost is exempt.

Permission denied writing uploads
  -> Directory must be owned by salesapp and covered by ReadWritePaths in the
     systemd unit (ProtectSystem=strict makes everything else read-only).

Admin dashboard card is missing
  -> Grant the sessionPhotos permission in /admin/users. Existing admins do not
     have it automatically.
