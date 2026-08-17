#!/usr/bin/env bash
#
# One-time Hostinger VPS setup for Sales Reconciliation.
# Run once as root on a fresh Ubuntu 22.04/24.04 server:
#
#   bash deploy/scripts/vps-bootstrap.sh
#
# Idempotent — safe to re-run. It installs system packages, creates the
# service account, database and directories, and installs the nginx site and
# systemd unit. It does NOT build or start the app; run deploy.sh for that.

set -euo pipefail

# ── Settings — override by exporting before running ─────────────────────────
APP_NAME="${APP_NAME:-sales-reconciliation}"
APP_USER="${APP_USER:-salesapp}"
APP_ROOT="${APP_ROOT:-/opt/${APP_NAME}}"
UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/${APP_NAME}/uploads}"
ENV_DIR="${ENV_DIR:-/etc/${APP_NAME}}"
REPO_URL="${REPO_URL:-https://github.com/jagannatarajan1/sales-reconciliation.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
DB_NAME="${DB_NAME:-sales_reconciliation}"
DB_USER="${DB_USER:-salesapp}"
NODE_MAJOR="${NODE_MAJOR:-22}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo bash $0)" >&2
  exit 1
fi

# ── System packages ─────────────────────────────────────────────────────────
log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg nginx postgresql postgresql-contrib ufw

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
node -v

# ── Service account ─────────────────────────────────────────────────────────
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "Creating service account ${APP_USER}"
  # A real shell so `sudo -u ... bash -c` in deploy.sh works; the account is
  # still a system account with no password, so it cannot be logged into.
  adduser --system --group --home "/home/${APP_USER}" --shell /bin/bash "$APP_USER"
  mkdir -p "/home/${APP_USER}"
  chown "${APP_USER}:${APP_USER}" "/home/${APP_USER}"
fi

# ── Directories ─────────────────────────────────────────────────────────────
log "Creating directories"
mkdir -p "$APP_ROOT" "$UPLOAD_DIR" "$ENV_DIR"
# nginx must be able to traverse into the upload tree to serve files via
# X-Accel-Redirect, but only the app account may write to it.
chown -R "${APP_USER}:${APP_USER}" "$APP_ROOT" "$UPLOAD_DIR"
chmod 750 "$UPLOAD_DIR"
usermod -aG "$APP_USER" www-data
chmod 750 "$(dirname "$UPLOAD_DIR")"
chown "${APP_USER}:${APP_USER}" "$(dirname "$UPLOAD_DIR")"

# ── PostgreSQL ──────────────────────────────────────────────────────────────
log "Configuring PostgreSQL"
systemctl enable --now postgresql

DB_PASSWORD_FILE="${ENV_DIR}/db_password"
if [[ ! -f "$DB_PASSWORD_FILE" ]]; then
  head -c 32 /dev/urandom | base64 | tr -d '/+=' > "$DB_PASSWORD_FILE"
  chmod 600 "$DB_PASSWORD_FILE"
fi
DB_PASSWORD="$(cat "$DB_PASSWORD_FILE")"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -qc "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';"
else
  sudo -u postgres psql -qc "ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

# ── Repository ──────────────────────────────────────────────────────────────
if [[ ! -d "${APP_ROOT}/.git" ]]; then
  log "Cloning ${REPO_URL} (${REPO_BRANCH})"
  sudo -u "$APP_USER" git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_ROOT"
else
  log "Repository already present at ${APP_ROOT}"
fi

# ── API environment file ────────────────────────────────────────────────────
API_ENV="${ENV_DIR}/api.env"
if [[ ! -f "$API_ENV" ]]; then
  log "Writing ${API_ENV} — EDIT THIS before the first deploy"
  JWT_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
  cat > "$API_ENV" <<EOF
# Sales Reconciliation API — production environment.
# Read by systemd (EnvironmentFile), so a redeploy never overwrites it.

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"

PORT=5000
NODE_ENV=production

JWT_SECRET=${JWT_SECRET}
JWT_ISSUER=SalesReconciliationApp
JWT_AUDIENCE=SalesReconciliationClient
JWT_EXPIRATION_MINUTES=1440

# nginx serves the UI on the same origin, so the browser never makes a
# cross-origin API call. Listed anyway for any direct API consumer.
CORS_ALLOWED_ORIGINS=https://CHANGE-ME.example.com

# ── Photo attachments ──
UPLOAD_DIR=${UPLOAD_DIR}
UPLOAD_ACCEL_REDIRECT=/_protected_uploads

# ── Gmail (Z-report import + OTP email) — fill these in ──
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REDIRECT_URI=https://CHANGE-ME.example.com/api/gmail/callback
GMAIL_SENDER_EMAIL=
GMAIL_FRONTEND_BASE_URL=https://CHANGE-ME.example.com
EOF
  chmod 640 "$API_ENV"
  chown "root:${APP_USER}" "$API_ENV"
else
  log "${API_ENV} already exists — leaving it untouched"
fi

# ── systemd unit ────────────────────────────────────────────────────────────
log "Installing systemd unit"
sed -e "s|@APP_USER@|${APP_USER}|g" \
    -e "s|@APP_ROOT@|${APP_ROOT}|g" \
    -e "s|@ENV_DIR@|${ENV_DIR}|g" \
    -e "s|@UPLOAD_DIR@|${UPLOAD_DIR}|g" \
    "${APP_ROOT}/deploy/systemd/sales-api.service" > /etc/systemd/system/sales-api.service
systemctl daemon-reload
systemctl enable sales-api

# ── nginx ───────────────────────────────────────────────────────────────────
log "Installing nginx site"
sed -e "s|@APP_ROOT@|${APP_ROOT}|g" \
    -e "s|@UPLOAD_DIR@|${UPLOAD_DIR}|g" \
    "${APP_ROOT}/deploy/nginx/sales-reconciliation.conf" > "/etc/nginx/sites-available/${APP_NAME}"
ln -sf "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
rm -f /etc/nginx/sites-enabled/default
nginx -t

# ── Firewall ────────────────────────────────────────────────────────────────
log "Configuring firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status

cat <<EOF

────────────────────────────────────────────────────────────────────────────
Bootstrap complete. Next steps:

  1. Edit ${API_ENV} — replace every CHANGE-ME.example.com with your domain
     and fill in the Gmail credentials.

  2. Set your domain in the nginx site:
       nano /etc/nginx/sites-available/${APP_NAME}     # server_name
       systemctl reload nginx

  3. Get a TLS certificate:
       apt-get install -y certbot python3-certbot-nginx
       certbot --nginx -d your-domain.com -d www.your-domain.com

  4. Deploy the application:
       bash ${APP_ROOT}/deploy/scripts/deploy.sh

  5. Create the first admin account (registration is locked down in-app):
       see deploy/README.md → "First admin account"

Database password is stored at ${DB_PASSWORD_FILE}
────────────────────────────────────────────────────────────────────────────
EOF
