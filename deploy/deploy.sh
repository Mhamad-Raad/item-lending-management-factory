#!/usr/bin/env bash
# Deploy (or roll back to) a given git commit SHA on the VPS.
# Usage: /opt/pallet/deploy/deploy.sh <git-sha>
# Called by .github/workflows/deploy.yml over SSH; can be run by hand (docs/runbooks/deploy.md).
# Rule: migrations are expand-only for one release, so the previous image keeps working after a
# migration has run — which makes the automatic image rollback below safe.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/pallet}"
NEW_SHA="${1:?usage: deploy.sh <git-sha>}"
HEALTH_TIMEOUT_SECONDS=60
# A dump of the database taken right before each migration (Q84); the newest PRE_MIGRATE_KEEP are kept.
PRE_MIGRATE_DIR="${PRE_MIGRATE_DIR:-/var/backups/pallet/pre-migrate}"
PRE_MIGRATE_KEEP=5
PRE_MIGRATE_DUMP=""

cd "$APP_DIR"
[[ -f .env ]] || { echo "missing $APP_DIR/.env" >&2; exit 1; }

# The .env.example placeholder and the development, CI and e2e secrets are public (so is the repository): a
# token secret anyone can read lets anyone sign in as an admin. Refuse, before anything changes, every secret
# the production API refuses at startup (jwtSecretProblem in apps/api/src/config/env.ts — keep the two in
# step): otherwise the new API would not start and the deploy would roll back after an outage. Never print it.
env_value() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- || true; }
jwt_secret_problem() {
  local secret="$1" lower length distinct most_common period marker
  lower="$(printf '%s' "$secret" | tr '[:upper:]' '[:lower:]')"
  length=${#secret}
  if [[ -z "$secret" ]]; then echo "is missing"; return; fi
  if [[ "$lower" == *change-me* ]]; then echo "is still the .env.example placeholder"; return; fi
  if (( length < 64 )); then echo "is shorter than 64 characters"; return; fi
  for marker in dev-only ci-only e2e-only example; do
    if [[ "$lower" == *"$marker"* ]]; then echo "is a development/CI value published in the repository"; return; fi
  done
  # Same thresholds as the API: fewer than 12 distinct characters, one character filling more than a
  # quarter of the string, or a short block repeated.
  distinct="$(printf '%s' "$secret" | fold -w1 | sort -u | wc -l | tr -d ' ')"
  most_common="$(printf '%s' "$secret" | fold -w1 | sort | uniq -c | awk '$1 > m { m = $1 } END { print m + 0 }')"
  if (( distinct < 12 || most_common * 4 > length )); then
    echo "looks too predictable (too few distinct characters)"; return
  fi
  for (( period = 1; period * 4 <= length; period++ )); do
    if [[ "${secret:period}" == "${secret:0:length-period}" ]]; then
      echo "looks too predictable (a repeated pattern)"; return
    fi
  done
}
jwt_problem="$(jwt_secret_problem "$(env_value JWT_ACCESS_SECRET)")"
if [[ -n "$jwt_problem" ]]; then
  echo "deploy: refused — JWT_ACCESS_SECRET in $APP_DIR/.env $jwt_problem." >&2
  echo "deploy: generate one with \`openssl rand -hex 64\`, store it in the password manager" \
    "(docs/runbooks/rotate-secrets.md), put it in .env and deploy again. Nothing was changed." >&2
  exit 1
fi
unset jwt_problem
# The first admin is seeded from ADMIN_PASSWORD while the users table is empty (Q120). The .env.example
# placeholder is public, so it is refused here as the migrate step would refuse it — before anything changes.
# The full policy (the common-password list) is the migrate step's; this catches the placeholder and length.
admin_password="$(env_value ADMIN_PASSWORD)"
if [[ -n "$admin_password" ]]; then
  if [[ "$(printf '%s' "$admin_password" | tr '[:upper:]' '[:lower:]')" == *change-me* ]]; then
    admin_problem="is still the .env.example placeholder"
  elif (( ${#admin_password} < 10 )); then
    admin_problem="is shorter than 10 characters"
  else
    admin_problem=""
  fi
  if [[ -n "$admin_problem" ]]; then
    echo "deploy: refused — ADMIN_PASSWORD in $APP_DIR/.env $admin_problem." >&2
    echo "deploy: before the first deploy set a long random one (\`openssl rand -hex 16\`); after the first" \
      "sign-in delete the ADMIN_PASSWORD line (it is ignored once a user exists). Nothing was changed." >&2
    exit 1
  fi
fi
unset admin_password admin_problem
for name in POSTGRES_PASSWORD DB_OWNER_PASSWORD DB_APP_PASSWORD; do
  if [[ "$(env_value "$name")" == *change-me* ]]; then
    echo "deploy: WARNING — $name in .env is still the .env.example placeholder; rotate it" \
      "(docs/runbooks/rotate-secrets.md)." >&2
  fi
done

current_version() { grep -E '^APP_VERSION=' .env | cut -d= -f2-; }
set_version() { sed -i -E "s/^APP_VERSION=.*/APP_VERSION=$1/" .env; }

PREV_SHA="$(current_version)"
ORIGINAL_VERSION="$PREV_SHA"
# A fresh .env carries the all-zero placeholder from .env.example, and nothing guarantees an old value
# still names a commit this clone has: neither is a version to roll back to, so a failed first deploy
# stops with nothing restarted instead of dying inside the rollback on `git checkout`.
if [[ "$PREV_SHA" =~ ^0*$ ]] || ! git cat-file -e "${PREV_SHA}^{commit}" 2>/dev/null; then
  PREV_SHA=""
fi
echo "deploy: ${PREV_SHA:-<none>} -> $NEW_SHA"

rollback() {
  trap - ERR
  echo "deploy: FAILED — rolling back to $PREV_SHA" >&2
  if [[ -n "$PRE_MIGRATE_DUMP" ]]; then
    echo "deploy: the database as it was before the migration is in $PRE_MIGRATE_DUMP. If the migration" \
      "itself failed, see \"A failed migration\" in docs/runbooks/deploy.md before deploying again." >&2
  fi
  if [[ -n "$PREV_SHA" ]]; then
    git checkout --quiet --detach "$PREV_SHA"
    set_version "$PREV_SHA"
    docker compose up -d --remove-orphans
  else
    # Put back what .env said before: the failed SHA must not become the next deploy's rollback target.
    set_version "$ORIGINAL_VERSION"
    echo "deploy: no previous version to restore — fix the cause and deploy again" >&2
  fi
  exit 1
}

# Compose file, Caddy/Postgres init files and scripts must match the image version.
git fetch --quiet origin --tags
git checkout --quiet --detach "$NEW_SHA"
set_version "$NEW_SHA"
# From here on any failure — a pull, the migration, `up` — puts the previous version back: otherwise .env
# would name a version that never passed the health check, and the next deploy would take it as the one
# to roll back to.
trap rollback ERR

docker compose pull caddy api
docker compose --profile migrate pull migrate

# The nightly backup can be up to a day old: dump the database right before the migration touches it, so a
# migration that goes wrong can be undone without losing today's work (docs/runbooks/deploy.md). The API is
# stopped first, so nothing is written after the dump; Caddy answers 502 meanwhile, which the web app shows as
# "unavailable, try again" without signing anyone out. A rollback starts it again.
docker compose stop api
docker compose up -d --wait postgres
install -d -m 700 "$PRE_MIGRATE_DIR"
dump_file="$PRE_MIGRATE_DIR/pre-migrate-$(date -u +%Y%m%dT%H%M%SZ)-${NEW_SHA:0:12}.dump"
# The dump holds every customer and password hash: owner-only from the moment it exists, not after a chmod.
# Scoped to the dump — the checkout above must keep the modes the containers need to read their files.
saved_umask="$(umask)"
umask 077
docker compose exec -T postgres pg_dump -U pallet_owner -d pallet -Fc > "$dump_file"
umask "$saved_umask"
if [[ ! -s "$dump_file" ]]; then
  rm -f -- "$dump_file"
  echo "deploy: the pre-migration dump came out empty — nothing was migrated" >&2
  false
fi
PRE_MIGRATE_DUMP="$dump_file"
echo "deploy: database saved to $PRE_MIGRATE_DUMP"
# Newest first; everything after the newest PRE_MIGRATE_KEEP goes. The names are ours and hold no spaces.
# shellcheck disable=SC2012
ls -1t -- "$PRE_MIGRATE_DIR"/pre-migrate-*.dump | tail -n +$((PRE_MIGRATE_KEEP + 1)) | while read -r old_dump; do
  rm -f -- "$old_dump"
done

docker compose --profile migrate run --rm migrate
docker compose up -d --remove-orphans

deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until docker compose exec -T api node dist/scripts/healthcheck.js >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then rollback; fi
  sleep 3
done

trap - ERR
echo "$PREV_SHA" > .previous_version
docker image prune -f --filter "until=720h" >/dev/null
echo "deploy: OK ($NEW_SHA)"
