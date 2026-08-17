# Deploying Sales Reconciliation to a Hostinger VPS

The app is two pieces that ship together:

| Piece | Path | Runs as |
|---|---|---|
| API — Express + Prisma + PostgreSQL | `Sales-api` | `sales-api` systemd service on port 5000 |
| UI — React + Vite | `Sales-ui-sales_ui/sales-reconciliation-ui` | static files served by nginx |

nginx terminates TLS, serves the built UI, and proxies `/api` to the Node
process on the same origin. That is why `.env.production` already contains
`VITE_API_URL=/api` — no CORS is involved in normal use.

This replaces the previous split hosting (UI on Vercel, API on Render). The
old `vercel.json` rewrite to `sales-reconciliation-api-qzma.onrender.com` is
not used by this setup.

---

## What you need before starting

- A Hostinger VPS running Ubuntu 22.04 or 24.04, with root SSH access.
- A domain (or subdomain) with an A record pointing at the VPS IP.
- The Gmail OAuth credentials the app uses for Z-report import and admin OTP
  email (see `GMAIL_OAUTH_SETUP.md` in the UI folder).

---

## First-time setup

**1. Copy the repo onto the server and run the bootstrap.**

```bash
ssh root@YOUR_VPS_IP

git clone https://github.com/jagannatarajan1/sales-reconciliation.git /tmp/sr
bash /tmp/sr/deploy/scripts/vps-bootstrap.sh
```

The bootstrap is idempotent and does the following:

- installs Node 22, PostgreSQL, nginx and ufw
- creates the `salesapp` system account
- creates the `sales_reconciliation` database with a generated password
- clones the repo to `/opt/sales-reconciliation`
- writes `/etc/sales-reconciliation/api.env` with a generated `JWT_SECRET`
- installs the systemd unit and the nginx site
- opens ports 22, 80 and 443

**2. Fill in the environment file.**

```bash
nano /etc/sales-reconciliation/api.env
```

Replace every `CHANGE-ME.example.com` with your real domain and fill in the
four `GMAIL_*` values. Leave `DATABASE_URL`, `JWT_SECRET`, `UPLOAD_DIR` and
`UPLOAD_ACCEL_REDIRECT` as generated.

**3. Set your domain in nginx and get a certificate.**

```bash
nano /etc/nginx/sites-available/sales-reconciliation   # server_name
systemctl reload nginx

apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

Certbot rewrites the site file in place to add the TLS listener and the
port-80 redirect. Renewal is automatic via its systemd timer.

**4. Deploy.**

```bash
bash /opt/sales-reconciliation/deploy/scripts/deploy.sh
```

**5. Turn on backups.** See [Backups](#backups) — this one matters more than
usual now, because photos live on disk rather than in the database.

---

## Updating an existing deployment

```bash
ssh root@YOUR_VPS_IP
bash /opt/sales-reconciliation/deploy/scripts/deploy.sh
```

That pulls `main`, reinstalls dependencies, regenerates the Prisma client,
applies the schema, rebuilds both apps and restarts the API. To deploy a
different branch:

```bash
REPO_BRANCH=client-1 bash /opt/sales-reconciliation/deploy/scripts/deploy.sh
```

The script aborts if the API fails to come back up, printing the last 40 lines
of the journal.

### Schema changes

There is no `prisma/migrations` directory in this project, so the deploy uses
`prisma db push`. Without `--accept-data-loss` it refuses to drop or rename a
column, so a destructive schema change fails the deploy rather than quietly
destroying data. If that happens, inspect the change and apply it by hand.

---

## Photo attachments

Photos are written to `/var/lib/sales-reconciliation/uploads`, laid out as:

```
<section>/<YYYY-MM-DD>/<uuid>.<ext>
```

so a single day's evidence can be archived or pruned with one directory
operation.

**They are not publicly reachable.** Every request goes through
`GET /api/attachments/:id/file`, which checks the bearer token and the
section's permission first, then hands the file to nginx via
`X-Accel-Redirect` pointing at the `internal` `/_protected_uploads/` location.
nginx does the disk I/O; Node only does the authorisation. A browser hitting
`/_protected_uploads/...` directly gets a 404.

Limits, enforced in both places:

| Limit | Value | Set in |
|---|---|---|
| Max file size | 15 MB | `MAX_FILE_BYTES`, `client_max_body_size` |
| Max files per request | 10 | `MAX_FILES_PER_REQUEST` |
| Accepted types | JPEG, PNG, WebP, GIF, HEIC | content sniffing, not the filename |

The browser downscales images to a 1600px long edge before upload, so a typical
phone photo arrives around 300–500KB rather than 3–8MB.

### Disk usage

Rough sizing: 10 photos/day at ~400KB each is about 1.5GB/year. To check:

```bash
du -sh /var/lib/sales-reconciliation/uploads
du -sh /var/lib/sales-reconciliation/uploads/*
```

---

## Backups

**A database-only backup is not sufficient.** The `Attachment` rows are in
Postgres but the image bytes are on the filesystem; restoring one without the
other leaves every photo broken.

`deploy/scripts/backup.sh` captures both. Install it as a nightly cron job:

```bash
echo '15 2 * * * root /opt/sales-reconciliation/deploy/scripts/backup.sh' \
  > /etc/cron.d/sales-reconciliation-backup
```

It writes to `/var/backups/sales-reconciliation` and keeps 14 days. Copy those
off the box — a backup that only exists on the machine it protects is not a
backup.

### Restoring

```bash
systemctl stop sales-api
pg_restore --clean --dbname="$DATABASE_URL" /var/backups/sales-reconciliation/db_STAMP.dump
tar -xzf /var/backups/sales-reconciliation/uploads_STAMP.tar.gz -C /var/lib/sales-reconciliation/
chown -R salesapp:salesapp /var/lib/sales-reconciliation/uploads
systemctl start sales-api
```

---

## First admin account

In-app registration is deliberately locked down, so the first admin is created
directly against the database. Generate a bcrypt hash and insert the row:

```bash
cd /opt/sales-reconciliation/Sales-api
sudo -u salesapp node -e "
  const bcrypt = require('bcrypt');
  bcrypt.hash(process.argv[1], 10).then(h => console.log(h));
" 'YOUR_STRONG_PASSWORD'
```

```bash
sudo -u postgres psql sales_reconciliation -c "
  INSERT INTO \"User\" (email, \"passwordHash\", name, role, permissions)
  VALUES ('you@example.com', 'PASTE_HASH_HERE', 'Your Name', 'admin',
          ARRAY['sales','suppliers','scratchCards','reports','userManagement',
                'settings','lottery','paypoint','commitHistory']);
"
```

Admin logins additionally require an emailed OTP, so the `GMAIL_*` settings
must be working before an admin can get in.

---

## Operations

```bash
# Logs
journalctl -u sales-api -f
tail -f /var/log/nginx/sales-reconciliation.error.log

# Service control
systemctl restart sales-api
systemctl status sales-api

# Config check
nginx -t && systemctl reload nginx
```

### Troubleshooting

**502 from nginx** — the API is down. `journalctl -u sales-api -n 50`. Most
often a bad value in `/etc/sales-reconciliation/api.env`, or Postgres not
running.

**413 on photo upload** — `client_max_body_size` in the nginx site is lower
than what is being sent. It ships at `160m`.

**Photos upload but do not display** — check `UPLOAD_ACCEL_REDIRECT` is
`/_protected_uploads` and that the nginx `alias` path matches `UPLOAD_DIR`
exactly, trailing slash included. As a fallback, clearing
`UPLOAD_ACCEL_REDIRECT` makes Node stream the files itself, which is slower but
removes nginx from the equation while you diagnose.

**Camera button does nothing** — `getUserMedia` requires a secure context.
Over plain HTTP the component falls back to the OS camera app via a file
input; finish the certbot step to get the in-page camera.

**Permission denied writing uploads** — the upload directory must be owned by
`salesapp`, and `ReadWritePaths` in the systemd unit must cover it. The unit
runs with `ProtectSystem=strict`, so the rest of the filesystem is read-only to
the service by design.
