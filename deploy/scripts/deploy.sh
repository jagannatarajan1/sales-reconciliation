#!/usr/bin/env bash
#
# Deploy / update Sales Reconciliation on the VPS.
# Run as root after vps-bootstrap.sh has completed:
#
#   bash /opt/sales-reconciliation/deploy/scripts/deploy.sh
#
# Pulls the latest code, installs dependencies, applies the database schema,
# builds both applications and restarts the API. Safe to re-run.
#
# Environment overrides:
#   REPO_BRANCH=client-1   deploy a branch other than main
#   SKIP_PULL=1            build what is already checked out

set -euo pipefail

APP_NAME="${APP_NAME:-sales-reconciliation}"
APP_USER="${APP_USER:-salesapp}"
APP_ROOT="${APP_ROOT:-/opt/${APP_NAME}}"
ENV_DIR="${ENV_DIR:-/etc/${APP_NAME}}"
REPO_BRANCH="${REPO_BRANCH:-main}"
API_DIR="${APP_ROOT}/Sales-api"
UI_DIR="${APP_ROOT}/Sales-ui-sales_ui/sales-reconciliation-ui"
SKIP_PULL="${SKIP_PULL:-0}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo bash $0)" >&2
  exit 1
fi

# The API's DATABASE_URL lives in the systemd environment file, not in the
# repo, so prisma needs it passed through explicitly below.
set -a
# shellcheck disable=SC1090
source "${ENV_DIR}/api.env"
set +a

# Run a command as the app user, in a given directory. DATABASE_URL is passed
# via `env` rather than sudo's env_keep, which is stripped by default on a
# stock Ubuntu sudoers.
run_in() {
  local dir="$1"; shift
  sudo -u "$APP_USER" env "DATABASE_URL=${DATABASE_URL}" "HOME=/home/${APP_USER}" \
    bash -c "cd '${dir}' && $*"
}

if [[ "$SKIP_PULL" != "1" ]]; then
  log "Pulling latest code (${REPO_BRANCH})"
  run_in "$APP_ROOT" "git fetch --prune origin"
  run_in "$APP_ROOT" "git checkout '${REPO_BRANCH}'"
  run_in "$APP_ROOT" "git reset --hard 'origin/${REPO_BRANCH}'"
fi

log "Deploying $(run_in "$APP_ROOT" "git rev-parse --short HEAD")"

# ── API ─────────────────────────────────────────────────────────────────────
log "Installing API dependencies"
run_in "$API_DIR" "npm ci"

log "Generating Prisma client"
run_in "$API_DIR" "npx prisma generate"

# This project has no prisma/migrations directory — the schema is applied
# directly. Without --accept-data-loss, `db push` refuses rather than dropping
# a column, so a release that removes a field fails here instead of silently
# destroying data. If that happens, inspect the change and re-run by hand.
log "Applying database schema"
run_in "$API_DIR" "npx prisma db push --skip-generate" \
  || { echo "Schema push refused — it would lose data. Review the change before retrying." >&2; exit 1; }

log "Building API"
run_in "$API_DIR" "npm run build"

# ── UI ──────────────────────────────────────────────────────────────────────
log "Installing UI dependencies"
run_in "$UI_DIR" "npm ci"

# .env.production already sets VITE_API_URL=/api, which is correct when nginx
# serves the UI and proxies /api on the same origin.
log "Building UI"
run_in "$UI_DIR" "npm run build"

# ── Restart ─────────────────────────────────────────────────────────────────
log "Restarting API"
systemctl restart sales-api
sleep 2

if ! systemctl is-active --quiet sales-api; then
  echo "sales-api failed to start. Recent logs:" >&2
  journalctl -u sales-api --no-pager --lines=40 >&2
  exit 1
fi
systemctl --no-pager --lines=10 status sales-api || true

log "Reloading nginx"
nginx -t && systemctl reload nginx

log "Deploy complete"
