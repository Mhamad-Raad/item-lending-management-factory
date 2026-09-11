#!/usr/bin/env bash
# Restore database + uploads from a restic snapshot (docs/runbooks/restore-from-backup.md).
# Usage: restore.sh --yes [snapshot-id|latest]
# DESTRUCTIVE: replaces the `pallet` database and the uploads volume. Requires /etc/pallet/backup.env.
set -Eeuo pipefail

[[ "${1:-}" == "--yes" ]] || { echo "usage: restore.sh --yes [snapshot-id|latest]" >&2; exit 2; }
SNAPSHOT="${2:-latest}"

# shellcheck source=/dev/null
source /etc/pallet/backup.env
export RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

APP_DIR=/opt/pallet
WORK_DIR="/var/restore/pallet-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$WORK_DIR"

echo "1/6 restic restore $SNAPSHOT → $WORK_DIR"
restic restore "$SNAPSHOT" --tag pallet --target "$WORK_DIR"
DUMP_FILE="$(find "$WORK_DIR" -name 'pallet-*.dump' | sort | tail -n 1)"
UPLOADS_SRC="$(find "$WORK_DIR" -type d -path '*pallet_uploads/_data' | head -n 1)"
[[ -n "$DUMP_FILE" ]] || { echo "no dump in snapshot" >&2; exit 1; }

cd "$APP_DIR"
echo "2/6 stop caddy + api"
docker compose stop caddy api

echo "3/6 ensure postgres is up (roles are created by deploy/postgres/init on an empty volume)"
docker compose up -d postgres
until docker compose exec -T postgres pg_isready -U postgres -d postgres >/dev/null 2>&1; do sleep 2; done

echo "4/6 recreate database and pg_restore"
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "DROP DATABASE IF EXISTS pallet WITH (FORCE);" \
  -c "CREATE DATABASE pallet OWNER pallet_owner;"
docker compose exec -T postgres pg_restore -U pallet_owner -d pallet --exit-on-error < "$DUMP_FILE"

echo "5/6 restore uploads volume"
if [[ -n "$UPLOADS_SRC" ]]; then
  UPLOADS_DST="$(docker volume inspect pallet_uploads --format '{{ .Mountpoint }}')"
  rsync -a --delete "$UPLOADS_SRC/" "$UPLOADS_DST/"
  chown -R 1000:1000 "$UPLOADS_DST"
else
  echo "warning: snapshot contains no uploads directory" >&2
fi

echo "6/6 re-apply grants (migrate is idempotent) and start"
docker compose --profile migrate run --rm migrate
docker compose up -d
echo "restore OK from $SNAPSHOT — run the reconciliation check: docker compose exec -T api node dist/scripts/reconcile.js"
