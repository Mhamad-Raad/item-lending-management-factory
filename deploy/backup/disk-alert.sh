#!/usr/bin/env bash
# Disk-space alert. Cron (root): */15 * * * * /opt/pallet/deploy/backup/disk-alert.sh
# Pings HEALTHCHECKS_DISK_URL on success, HEALTHCHECKS_DISK_URL/fail when any watched filesystem ≥ 80 %.
set -Eeuo pipefail

# shellcheck source=/dev/null
source /etc/pallet/backup.env
: "${HEALTHCHECKS_DISK_URL:?}"
THRESHOLD=80

DOCKER_ROOT="$(docker info --format '{{ .DockerRootDir }}' 2>/dev/null || echo /var/lib/docker)"
report=""
status=ok
for path in / "$DOCKER_ROOT" /var/backups; do
  [[ -e "$path" ]] || continue
  used="$(df --output=pcent "$path" | tail -n 1 | tr -dc '0-9')"
  report+="$path=${used}% "
  if (( used >= THRESHOLD )); then status=fail; fi
done

if [[ "$status" == "fail" ]]; then
  curl -fsS -m 10 --retry 3 --data-raw "$report" "$HEALTHCHECKS_DISK_URL/fail" >/dev/null || true
else
  curl -fsS -m 10 --retry 3 --data-raw "$report" "$HEALTHCHECKS_DISK_URL" >/dev/null || true
fi
