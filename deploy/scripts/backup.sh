#!/usr/bin/env bash
#
# Nightly backup of the database AND the uploaded photos.
#
# The photos live on the filesystem, not in Postgres — a database-only backup
# will restore the reconciliation figures but leave every attachment pointing
# at a missing file. Both halves must be captured together.
#
# Install as a cron job:
#   echo '15 2 * * * root /opt/sales-reconciliation/deploy/scripts/backup.sh' \
#     > /etc/cron.d/sales-reconciliation-backup

set -euo pipefail

APP_NAME="${APP_NAME:-sales-reconciliation}"
ENV_DIR="${ENV_DIR:-/etc/${APP_NAME}}"
UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/${APP_NAME}/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/${APP_NAME}}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

set -a
# shellcheck disable=SC1090
source "${ENV_DIR}/api.env"
set +a

STAMP="$(date +%Y-%m-%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# pg_dump reads the connection string straight from DATABASE_URL.
pg_dump --dbname="$DATABASE_URL" --format=custom \
  --file="${BACKUP_DIR}/db_${STAMP}.dump"

tar -czf "${BACKUP_DIR}/uploads_${STAMP}.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"

find "$BACKUP_DIR" -type f -name 'db_*.dump'        -mtime "+${RETENTION_DAYS}" -delete
find "$BACKUP_DIR" -type f -name 'uploads_*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "Backup complete: ${BACKUP_DIR}/db_${STAMP}.dump + uploads_${STAMP}.tar.gz"
