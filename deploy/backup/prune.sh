#!/usr/bin/env bash
# Backup retention — run from the MAINTAINER'S machine, never from the VPS (ARCHITECTURE.md §13.6, Q70).
# The VPS's bucket key is append-only (no deleteFiles), so it cannot forget or prune; this script uses a
# second key that can, kept only on the maintainer's machine and in the password manager.
# Usage: deploy/backup/prune.sh            (reads ~/.config/pallet/prune.env, or PALLET_PRUNE_ENV=<file>)
# Schedule: monthly (a calendar reminder or a local cron/launchd job). A missed month only costs storage.
set -Eeuo pipefail

ENV_FILE="${PALLET_PRUNE_ENV:-$HOME/.config/pallet/prune.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "prune: $ENV_FILE is missing — create it from deploy/backup/prune.env.example (chmod 600)." >&2
  exit 1
fi
if [[ -f /etc/pallet/backup.env ]]; then
  # The VPS has this file; a trusted machine does not. Pruning from the server defeats the point.
  echo "prune: refusing to run on a host with /etc/pallet/backup.env (the VPS). Run it from your own machine." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
export RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

ping() { [[ -n "${HEALTHCHECKS_PRUNE_URL:-}" ]] && curl -fsS -m 10 --retry 3 "$HEALTHCHECKS_PRUNE_URL$1" >/dev/null || true; }
trap 'ping /fail' ERR
ping /start

# 30 daily snapshots. With B2 Object Lock the deleted data stays (hidden) until its retention ends,
# then the bucket's lifecycle rule removes it.
restic forget --tag pallet --host pallet-vps --keep-daily 30 --prune
restic check

ping ""
echo "prune OK $(date -u +%Y%m%dT%H%M%SZ)"
