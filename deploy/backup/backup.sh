#!/usr/bin/env bash
# Nightly backup: pg_dump + uploads volume → restic (AES-256 encrypted) → off-site S3-compatible bucket.
# Cron (root, host in UTC): 30 23 * * *  /opt/pallet/deploy/backup/backup.sh >> /var/log/pallet-backup.log 2>&1
#   (= 02:30 Asia/Baghdad). Config: /etc/pallet/backup.env (mode 600, template: backup.env.example).
set -Eeuo pipefail

# shellcheck source=/dev/null
source /etc/pallet/backup.env
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}" "${HEALTHCHECKS_BACKUP_URL:?}"
export RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

ping() { curl -fsS -m 10 --retry 3 "$HEALTHCHECKS_BACKUP_URL$1" >/dev/null || true; }
trap 'ping /fail' ERR

APP_DIR=/opt/pallet
DUMP_DIR=/var/backups/pallet
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$DUMP_DIR/pallet-$STAMP.dump"

ping /start
install -d -m 700 "$DUMP_DIR"

# 1) Database (custom format, compressed). Local socket inside the container → no password needed.
cd "$APP_DIR"
docker compose exec -T postgres pg_dump -U pallet_owner -d pallet -Fc > "$DUMP_FILE"
[[ -s "$DUMP_FILE" ]] || { echo "empty dump" >&2; exit 1; }

# 2) Uploads volume (read directly from its mountpoint on the host).
UPLOADS_PATH="$(docker volume inspect pallet_uploads --format '{{ .Mountpoint }}')"

# 3) Encrypted, deduplicated snapshot off-site; 30-day retention.
restic backup --tag pallet --host pallet-vps "$DUMP_FILE" "$UPLOADS_PATH"
restic forget --tag pallet --host pallet-vps --keep-daily 30 --prune

# 4) Weekly (Sunday UTC) integrity check of 5 % of the data.
if [[ "$(date -u +%u)" == "7" ]]; then
  restic check --read-data-subset=5%
fi

# 5) Keep only 3 days of local dumps (the disk must never fill up).
find "$DUMP_DIR" -name 'pallet-*.dump' -mtime +3 -delete

ping ""
echo "backup OK $STAMP"
