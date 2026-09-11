#!/usr/bin/env bash
# Deploy (or roll back to) a given git commit SHA on the VPS.
# Usage: /opt/pallet/deploy/deploy.sh <git-sha>
# Called by .github/workflows/deploy.yml over SSH; can be run by hand (docs/runbooks/deploy.md).
# Rule: migrations are expand-only for one release, so the previous image keeps working after a
# migration has run — which makes the automatic image rollback below safe.
set -Eeuo pipefail

APP_DIR=/opt/pallet
NEW_SHA="${1:?usage: deploy.sh <git-sha>}"
HEALTH_TIMEOUT_SECONDS=60

cd "$APP_DIR"
[[ -f .env ]] || { echo "missing $APP_DIR/.env" >&2; exit 1; }

current_version() { grep -E '^APP_VERSION=' .env | cut -d= -f2-; }
set_version() { sed -i -E "s/^APP_VERSION=.*/APP_VERSION=$1/" .env; }

PREV_SHA="$(current_version)"
echo "deploy: ${PREV_SHA:-<none>} -> $NEW_SHA"

# Compose file, Caddy/Postgres init files and scripts must match the image version.
git fetch --quiet origin --tags
git checkout --quiet --detach "$NEW_SHA"
set_version "$NEW_SHA"

rollback() {
  echo "deploy: FAILED — rolling back to $PREV_SHA" >&2
  if [[ -n "$PREV_SHA" ]]; then
    git checkout --quiet --detach "$PREV_SHA"
    set_version "$PREV_SHA"
    docker compose up -d --remove-orphans
  fi
  exit 1
}

docker compose pull caddy api
docker compose --profile migrate pull migrate
docker compose --profile migrate run --rm migrate || rollback
docker compose up -d --remove-orphans

deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until docker compose exec -T api node dist/scripts/healthcheck.js >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then rollback; fi
  sleep 3
done

echo "$PREV_SHA" > .previous_version
docker image prune -f --filter "until=720h" >/dev/null
echo "deploy: OK ($NEW_SHA)"
