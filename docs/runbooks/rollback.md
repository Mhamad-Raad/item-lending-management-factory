# Runbook — roll back to the previous version

Automatic: `deploy.sh` already rolls back when the migrate step or the 60 s health check fails.

Manual (a bug is found after a successful deploy):

1. `ssh <user>@<vps>`; `cd /opt/pallet`.
2. Find the previous SHA: `cat .previous_version` (or `git log --oneline` / the GHCR package page).
3. Run `sudo ./deploy/deploy.sh <previous-sha>`.
4. Verify `/api/health` shows the previous version.

When the bad release contained a destructive (contract) migration or corrupted data:

1. Stop writes: `docker compose stop caddy api`.
2. Restore the last good backup (docs/runbooks/restore-from-backup.md) — every change after that backup is lost; export or note recent orders first if the database is still readable.
3. Deploy the previous SHA as above.

Never edit `_prisma_migrations` by hand to "undo" a migration.
