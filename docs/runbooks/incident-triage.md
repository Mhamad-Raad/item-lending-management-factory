# Incident triage

What to do first when an alert fires or a user reports the app is down. Each step names the runbook that
finishes the job. Work as `deploy` in `/opt/pallet` unless a step says otherwise.

## The uptime monitor or a user says the site is down

1. `curl -sS https://<APP_DOMAIN>/api/health` and read the body:
   - **connection refused / timeout** — the host or Caddy is down: `docker compose ps`, then
     `docker compose up -d`. If the VPS itself is unreachable, use the provider's console.
   - **503 `{ "reason": "database" }`** — PostgreSQL is not answering: `docker compose logs --tail 200 postgres`;
     `docker compose restart postgres`. If the data volume is damaged, `restore-from-backup.md`.
   - **503 `{ "reason": "disk" }`** — less than 256 MB free on the disk (the same disk holds the database):
     see "The disk is full" below.
   - **200** — the API is fine; the problem is between the user and Caddy (DNS, certificate, their network).
     `docker compose logs --tail 100 caddy` shows certificate renewals and refused connections.
2. After any restart, `curl` again and check `docker compose ps` shows every service `healthy`.

## The disk is full (disk-alert ping, or health says `disk`)

1. `df -h /` and `docker system df`.
2. Free space in this order, most to least likely: old images `docker image prune -a --filter "until=720h"`;
   local dumps older than three days under `/var/backups/pallet` (the backup script keeps three);
   container logs are capped at 50 MB × 30 files per service, so they are rarely the cause.
3. If uploads or the database genuinely need the room, resize the VPS disk (provider console), then
   `sudo resize2fs` or the provider's growpart step.
4. `curl -sS https://<APP_DOMAIN>/api/health` must return 200 again; PostgreSQL resumes writes on its own.

## The backup dead-man ping fired (`/fail`, or no ping for two days)

1. `tail -100 /var/log/pallet-backup.log` for the failing step (dump, restic, or the bucket).
2. Run `/opt/pallet/deploy/backup/backup.sh` by hand as root and watch it.
3. Bucket credentials or the restic password wrong: `rotate-secrets.md`, backup section.
4. Do not leave a night without a backup: if the script cannot be fixed the same day, take a manual
   `pg_dump` (`restore-from-backup.md` shows the command) and copy it off the host.

## Sentry alert (a 5xx from the API)

1. The event carries a `requestId`; `docker compose logs api | grep <requestId>` shows the request line
   (path, method, status, no query string) and the stack.
2. A one-off after a deploy: `rollback.md` if users are affected, else fix forward.
3. A `LedgerInvariantError` or a database constraint violation in the stack: run the reconciliation below
   before anything else.

## `reconcile` reports differences

`docker compose exec api node dist/scripts/reconcile.js` must print `0 discrepancies` (§4.9). If it does not:

1. Stop taking new entries (tell the office), keep the API running for reading.
2. Note every line it prints; each names the entity, id, field, the stored value and the recomputed one.
3. Never edit ledgers by hand. A maintained column that differs from its ledgers is repaired by the
   application's own recompute; the maintainer runs it from a database shell as `pallet_owner` for the
   named order ids, then reconciles again. A ledger row that breaks an invariant (a refund without a
   return, a payment on a cancelled order) is a bug: keep the output, restore is not the answer.
4. If the differences appeared right after a restore, the restore is incomplete: `restore-from-backup.md`
   with the previous snapshot.

## A user cannot sign in

`unlock-account.md` (lockout), `manage-users.md` (reset), `last-admin-recovery.md` (no admin left).
