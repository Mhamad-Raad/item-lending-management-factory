#!/usr/bin/env bash
# Restore database + uploads from a restic snapshot (docs/runbooks/restore-from-backup.md).
# Usage: restore.sh --yes [snapshot-id|latest]
# Replaces the `pallet` database and the uploads volume, but never destroys the current ones first (Q83):
#   - the current database is dumped to /var/backups/pallet/pre-restore-<stamp>.dump before anything changes;
#   - the snapshot is restored into a separate database `pallet_restore` and checked there;
#   - only then are the names swapped: the current database becomes `pallet_before_<stamp>` (kept, never
#     dropped by this script) and `pallet_restore` becomes `pallet`;
#   - the current uploads are copied to <work dir>/uploads-before before they are replaced.
# A failure before the swap leaves `pallet` exactly as it was. Requires /etc/pallet/backup.env.
set -Eeuo pipefail

[[ "${1:-}" == "--yes" ]] || { echo "usage: restore.sh --yes [snapshot-id|latest]" >&2; exit 2; }
SNAPSHOT="${2:-latest}"

# The paths can be overridden only to rehearse the script against a scratch compose project.
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/pallet/backup.env}"
[[ -r "$BACKUP_ENV_FILE" ]] || { echo "restore: cannot read $BACKUP_ENV_FILE (run as root?)" >&2; exit 1; }
# shellcheck source=/dev/null
source "$BACKUP_ENV_FILE"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must be set in $BACKUP_ENV_FILE}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD must be set in $BACKUP_ENV_FILE}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID must be set in $BACKUP_ENV_FILE}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY must be set in $BACKUP_ENV_FILE}"
export RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

APP_DIR="${APP_DIR:-/opt/pallet}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK_DIR="${RESTORE_ROOT:-/var/restore}/pallet-$STAMP"
SAFETY_DIR="${SAFETY_DIR:-/var/backups/pallet}"
SAFETY_DUMP="$SAFETY_DIR/pre-restore-$STAMP.dump"
# PostgreSQL folds unquoted names to lower case: the kept database is pallet_before_<stamp in lower case>.
KEPT_DB="pallet_before_$(tr '[:upper:]' '[:lower:]' <<< "$STAMP")"
SWAPPED=false

on_error() {
  trap - ERR
  if [[ "$SWAPPED" == true ]]; then
    echo "restore: FAILED after the swap. The restored data is now \`pallet\`; the previous database is" \
      "kept as \`$KEPT_DB\` and dumped to $SAFETY_DUMP. See \"Undo a restore\" in" \
      "docs/runbooks/restore-from-backup.md." >&2
  else
    echo "restore: FAILED before the swap — \`pallet\` is unchanged. Start the app again with" \
      "\`cd $APP_DIR && docker compose up -d\`, fix the cause and rerun." >&2
  fi
  exit 1
}
trap on_error ERR

psql_admin() { docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres -tA "$@"; }
database_exists() { [[ "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$1'")" == "1" ]]; }

install -d -m 700 "$WORK_DIR" "$SAFETY_DIR"

echo "1/8 restic restore $SNAPSHOT → $WORK_DIR"
restic restore "$SNAPSHOT" --tag pallet --target "$WORK_DIR"
DUMP_FILE="$(find "$WORK_DIR" -name 'pallet-*.dump' | sort | tail -n 1)"
UPLOADS_SRC="$(find "$WORK_DIR" -type d -path '*pallet_uploads/_data' | head -n 1)"
[[ -n "$DUMP_FILE" ]] || { echo "restore: the snapshot holds no pallet-*.dump — pick another snapshot" >&2; exit 1; }

cd "$APP_DIR"
echo "2/8 stop caddy + api"
docker compose stop caddy api

echo "3/8 ensure postgres is up (roles are created by deploy/postgres/init on an empty volume)"
docker compose up -d postgres
until docker compose exec -T postgres pg_isready -U postgres -d postgres >/dev/null 2>&1; do sleep 2; done

HAD_CURRENT=false
if database_exists pallet; then
  HAD_CURRENT=true
  echo "4/8 safety copy of the current database → $SAFETY_DUMP"
  docker compose exec -T postgres pg_dump -U pallet_owner -d pallet -Fc > "$SAFETY_DUMP"
  [[ -s "$SAFETY_DUMP" ]] || { echo "restore: the safety dump is empty — nothing was changed" >&2; exit 1; }
else
  echo "4/8 no current \`pallet\` database — nothing to keep"
fi

echo "5/8 restore into \`pallet_restore\` and check it"
psql_admin -c "DROP DATABASE IF EXISTS pallet_restore WITH (FORCE);" \
  -c "CREATE DATABASE pallet_restore OWNER pallet_owner ENCODING 'UTF8' TEMPLATE template0;"
docker compose exec -T postgres pg_restore -U pallet_owner -d pallet_restore --exit-on-error < "$DUMP_FILE"
# The database settings deploy/postgres/init/01-roles.sh gives `pallet` (a dump does not carry them). Per-database
# role settings follow the database itself, so they are set here and go with it through the rename.
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d pallet_restore <<'SQL'
REVOKE ALL ON DATABASE pallet_restore FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE pallet_restore TO pallet_owner;
GRANT CONNECT ON DATABASE pallet_restore TO pallet_app;
ALTER SCHEMA public OWNER TO pallet_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO pallet_app;
ALTER ROLE pallet_app IN DATABASE pallet_restore SET statement_timeout = '30s';
ALTER ROLE pallet_app IN DATABASE pallet_restore SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE pallet_app IN DATABASE pallet_restore SET timezone = 'UTC';
ALTER ROLE pallet_owner IN DATABASE pallet_restore SET timezone = 'UTC';
SQL
# A dump that restored without error but holds no applied migration or no admin is not a usable database.
CHECK="$(docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U pallet_owner -d pallet_restore -tA -c \
  "SELECT (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL) || ' ' ||
          (SELECT count(*) FROM users WHERE role = 'ADMIN' AND is_active)")"
read -r MIGRATIONS ADMINS <<< "$CHECK"
if (( MIGRATIONS == 0 || ADMINS == 0 )); then
  echo "restore: the restored database has $MIGRATIONS applied migrations and $ADMINS active admins —" \
    "refusing to swap it in. \`pallet\` is unchanged; \`pallet_restore\` is left for inspection." >&2
  exit 1
fi
echo "    $MIGRATIONS migrations applied, $ADMINS active admin(s)"

echo "6/8 swap: pallet → $KEPT_DB, pallet_restore → pallet"
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
               WHERE datname IN ('pallet', 'pallet_restore') AND pid <> pg_backend_pid();" >/dev/null
if [[ "$HAD_CURRENT" == true ]]; then
  psql_admin -c "ALTER DATABASE pallet RENAME TO $KEPT_DB;"
fi
SWAPPED=true
psql_admin -c "ALTER DATABASE pallet_restore RENAME TO pallet;"

echo "7/8 restore uploads volume (the current files are kept in $WORK_DIR/uploads-before)"
if [[ -n "$UPLOADS_SRC" ]]; then
  UPLOADS_DST="$(docker volume inspect pallet_uploads --format '{{ .Mountpoint }}')"
  rsync -a "$UPLOADS_DST/" "$WORK_DIR/uploads-before/"
  rsync -a --delete "$UPLOADS_SRC/" "$UPLOADS_DST/"
  chown -R 1000:1000 "$UPLOADS_DST"
else
  echo "warning: snapshot contains no uploads directory — the current uploads are left as they are" >&2
fi

echo "8/8 re-apply grants (migrate is idempotent) and start"
docker compose --profile migrate run --rm migrate
docker compose up -d
trap - ERR
echo "restore OK from $SNAPSHOT."
echo "Next: run the reconciliation check (docker compose exec -T api node dist/scripts/reconcile.js), sign in and"
echo "check recent orders. Once satisfied, follow \"After a restore\" in docs/runbooks/restore-from-backup.md:"
if [[ "$HAD_CURRENT" == true ]]; then
  echo "drop the previous database \`$KEPT_DB\`, and delete $WORK_DIR and $SAFETY_DUMP."
else
  echo "delete $WORK_DIR."
fi
