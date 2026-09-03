#!/usr/bin/env bash
# =============================================================================
# backup_postgres.sh — Nightly Postgres Backup for Smart OrderFlow
# =============================================================================
#
# Usage (cron example — runs at 02:00 every night):
#   0 2 * * * /opt/sof/backup_postgres.sh >> /var/log/sof-backup.log 2>&1
#
# Required environment variables (set in /etc/environment or a .env file):
#   POSTGRES_USER     — DB user (default: navaal_admin)
#   POSTGRES_DB       — DB name (default: sof_production)
#   POSTGRES_HOST     — DB host (default: db — Docker service name)
#   PGPASSWORD        — Postgres password (used by pg_dump automatically)
#   BACKUP_DIR        — Local directory to store backups (default: /opt/sof/backups)
#   BACKUP_RETAIN_DAYS — Days to keep local backups (default: 14)
#
# Optional S3/R2 upload (set to enable):
#   S3_BUCKET         — e.g. s3://my-bucket/sof-backups or r2://my-bucket/sof-backups
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION
#   (For R2: also set AWS_ENDPOINT_URL=https://<accountid>.r2.cloudflarestorage.com)
# =============================================================================
set -euo pipefail

# ── Config with sane defaults ──────────────────────────────────────────────────
POSTGRES_USER="${POSTGRES_USER:-navaal_admin}"
POSTGRES_DB="${POSTGRES_DB:-sof_production}"
POSTGRES_HOST="${POSTGRES_HOST:-db}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/opt/sof/backups}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/sof_${POSTGRES_DB}_${TIMESTAMP}.sql.gz"

# ── Ensure backup directory exists ────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"

echo "=== SOF Backup: $(date) ==="
echo "  DB      : ${POSTGRES_DB} @ ${POSTGRES_HOST}:${POSTGRES_PORT}"
echo "  Output  : ${BACKUP_FILE}"

# ── Dump & compress ───────────────────────────────────────────────────────────
pg_dump \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --no-password \
  --format=plain \
  --clean \
  --if-exists \
  "${POSTGRES_DB}" \
  | gzip -9 > "${BACKUP_FILE}"

BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "  Size    : ${BACKUP_SIZE}"
echo "  ✓ Dump complete."

# ── Optional: upload to S3 / Cloudflare R2 ────────────────────────────────────
if [[ -n "${S3_BUCKET:-}" ]]; then
  echo "  Uploading to ${S3_BUCKET} ..."
  if [[ -n "${AWS_ENDPOINT_URL:-}" ]]; then
    # Cloudflare R2 or any S3-compatible storage
    aws s3 cp "${BACKUP_FILE}" "${S3_BUCKET}/" \
      --endpoint-url="${AWS_ENDPOINT_URL}" \
      --no-progress
  else
    # Standard AWS S3
    aws s3 cp "${BACKUP_FILE}" "${S3_BUCKET}/" --no-progress
  fi
  echo "  ✓ Upload complete."
fi

# ── Prune old local backups ────────────────────────────────────────────────────
echo "  Pruning backups older than ${BACKUP_RETAIN_DAYS} days ..."
find "${BACKUP_DIR}" -name "sof_*.sql.gz" -mtime "+${BACKUP_RETAIN_DAYS}" -delete
REMAINING=$(find "${BACKUP_DIR}" -name "sof_*.sql.gz" | wc -l | tr -d ' ')
echo "  ${REMAINING} backup(s) retained."

echo "=== Backup finished: $(date) ==="
