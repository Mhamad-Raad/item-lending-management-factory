#!/usr/bin/env bash
# Backup retention — run from the MAINTAINER'S machine, never from the VPS (ARCHITECTURE.md §13.6, Q70, Q129).
# The VPS's bucket key is append-only (no deleteFiles), so it cannot forget or prune; this script uses a
# second key that can, kept only on the maintainer's machine and in the password manager.
# Usage: deploy/backup/prune.sh [--accept-day YYYY-MM-DD]...
#        (reads ~/.config/pallet/prune.env, or PALLET_PRUNE_ENV=<file>)
# Schedule: monthly (a calendar reminder or a local cron/launchd job). A missed month only costs storage.
# Needs restic and jq (macOS 15+ ships jq; otherwise `brew install jq`).
set -Eeuo pipefail

ENV_FILE="${PALLET_PRUNE_ENV:-$HOME/.config/pallet/prune.env}"
# What the last successful prune saw: its time and the snapshot ids that remained (see check_snapshots).
STATE_FILE="${PALLET_PRUNE_STATE:-$HOME/.config/pallet/prune.state}"
# A snapshot dated more than this far ahead of this machine's clock is not a clock difference.
FUTURE_TOLERANCE_SECONDS=3600

ACCEPT_DAYS=()
while (( $# > 0 )); do
  case "$1" in
    --accept-day)
      [[ "${2:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "prune: --accept-day needs a date YYYY-MM-DD" >&2; exit 1; }
      ACCEPT_DAYS+=("$2")
      shift 2
      ;;
    *)
      echo "prune: unknown argument $1 (usage: prune.sh [--accept-day YYYY-MM-DD]...)" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "prune: $ENV_FILE is missing — create it from deploy/backup/prune.env.example (chmod 600)." >&2
  exit 1
fi
if [[ -f /etc/pallet/backup.env ]]; then
  # The VPS has this file; a trusted machine does not. Pruning from the server defeats the point.
  echo "prune: refusing to run on a host with /etc/pallet/backup.env (the VPS). Run it from your own machine." >&2
  exit 1
fi
command -v jq >/dev/null || { echo "prune: jq is required (brew install jq)" >&2; exit 1; }

# shellcheck source=/dev/null
source "$ENV_FILE"
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
export RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

ping() { [[ -n "${HEALTHCHECKS_PRUNE_URL:-}" ]] && curl -fsS -m 10 --retry 3 "$HEALTHCHECKS_PRUNE_URL$1" >/dev/null || true; }
trap 'ping /fail' ERR
ping /start

# `id <TAB> epoch seconds <TAB> UTC day` for every nightly snapshot. restic writes the time with the backing-up
# host's offset and nanoseconds; jq's fromdateiso8601 wants whole seconds and `Z`.
list_snapshots() {
  restic snapshots --tag pallet --host pallet-vps --json | jq -r '
    def epoch:
      capture("^(?<dt>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(\\.[0-9]+)?(?<tz>Z|[+-][0-9]{2}:[0-9]{2})$")
      | (.dt + "Z" | fromdateiso8601)
        - (if .tz == "Z" then 0
           else ((.tz[1:3] | tonumber) * 3600 + (.tz[4:6] | tonumber) * 60) * (if .tz[0:1] == "+" then 1 else -1 end)
           end);
    .[] | (.time | epoch) as $t | [.id, ($t | tostring), ($t | strftime("%Y-%m-%d"))] | @tsv'
}

is_accepted_day() {
  local day="$1" accepted
  for accepted in ${ACCEPT_DAYS[@]+"${ACCEPT_DAYS[@]}"}; do
    [[ "$accepted" == "$day" ]] && return 0
  done
  return 1
}

# Refuse to forget anything when the snapshot list looks tampered with (Q129). Whoever holds the VPS's
# append-only key cannot delete, but can ADD snapshots with any `--time`. Retention keeps the newest snapshot of
# each day, month and year, so extra snapshots dated inside a day, or backdated into the past, can push the real
# ones out of the kept set — and this script's own prune would then delete them. Three signs:
#   1. more than one snapshot on one UTC day (the VPS takes one a night; a manual backup.sh run is the
#      innocent case — check it and pass --accept-day for that day);
#   2. a snapshot dated in the future;
#   3. a snapshot that was not there at the last prune but is dated before it (backdated).
check_snapshots() {
  local now snapshots problems="" day count id epoch last_prune known_ids=""
  now="$(date -u +%s)"
  snapshots="$(list_snapshots)"
  if [[ -z "$snapshots" ]]; then
    echo "prune: refused — the repository has no pallet snapshots at all; nothing to keep, nothing to prune." >&2
    return 1
  fi

  while IFS=$'\t' read -r count day; do
    if (( count > 1 )) && ! is_accepted_day "$day"; then
      problems+="  - $count snapshots on $day (UTC); the server takes one a night"$'\n'
    fi
  done < <(cut -f3 <<< "$snapshots" | sort | uniq -c | awk '{ print $1 "\t" $2 }')

  while IFS=$'\t' read -r id epoch day; do
    if (( epoch > now + FUTURE_TOLERANCE_SECONDS )); then
      problems+="  - snapshot ${id:0:8} is dated $day, in the future"$'\n'
    fi
  done <<< "$snapshots"

  if [[ -f "$STATE_FILE" ]]; then
    last_prune="$(sed -n 's/^last_prune_epoch=//p' "$STATE_FILE")"
    known_ids="$(sed -n 's/^id=//p' "$STATE_FILE")"
    if [[ "$last_prune" =~ ^[0-9]+$ ]]; then
      while IFS=$'\t' read -r id epoch day; do
        if (( epoch < last_prune )) && ! grep -qx "$id" <<< "$known_ids"; then
          problems+="  - snapshot ${id:0:8} is new since the last prune but dated $day, before it (backdated)"$'\n'
        fi
      done <<< "$snapshots"
    fi
  else
    echo "prune: no record of an earlier prune in $STATE_FILE — the backdating check starts with this run."
  fi

  if [[ -n "$problems" ]]; then
    {
      echo "prune: refused — nothing was forgotten or deleted. The snapshot list does not look like one nightly"
      echo "backup per day:"
      printf '%s' "$problems"
      echo "Look at them: restic snapshots --tag pallet --host pallet-vps"
      echo "If an extra snapshot on a day is yours (backup.sh run by hand), run again with --accept-day <that day>."
      echo "Otherwise treat the server as compromised: docs/runbooks/backup-keys.md, \"If the VPS was compromised\"."
    } >&2
    return 1
  fi
}

# Remembers what this prune left, for the next run's backdating check.
record_state() {
  local ids
  ids="$(list_snapshots | cut -f1)"
  mkdir -p "$(dirname "$STATE_FILE")"
  {
    echo "# Written by deploy/backup/prune.sh after each successful prune. Do not edit."
    echo "last_prune_epoch=$(date -u +%s)"
    sed 's/^/id=/' <<< "$ids"
  } > "$STATE_FILE.tmp"
  chmod 600 "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
}

check_snapshots

# Daily for a month, monthly for a year, yearly for five (Q129). With B2 Object Lock the data a prune deletes
# stays (hidden) until its lock ends, then the bucket's lifecycle rule removes it (backup-keys.md).
restic forget --tag pallet --host pallet-vps --keep-daily 30 --keep-monthly 12 --keep-yearly 5 --prune
restic check
record_state

ping ""
echo "prune OK $(date -u +%Y%m%dT%H%M%SZ)"
