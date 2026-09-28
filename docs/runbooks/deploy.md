# Runbook — deploy a new version

Normal path (automatic):

1. Merge to `main`; wait for CI to be green.
2. Tag: `git tag v1.4.0 && git push origin v1.4.0`.
3. GitHub Actions `Deploy` runs CI, pushes `ghcr.io/mhamad-raad/pallet-api:<sha>` and `pallet-caddy:<sha>`, then SSHes to the VPS and runs `/opt/pallet/deploy/deploy.sh <sha>`.
4. `deploy.sh` checks out `<sha>` in `/opt/pallet`, sets `APP_VERSION`, pulls images, stops the API, dumps the database to `/var/backups/pallet/pre-migrate/pre-migrate-<time>-<sha>.dump` (the newest five are kept), runs the `migrate` one-shot (migrations + grants + first-run seed), `docker compose up -d`, waits ≤ 60 s for the API health check, and rolls back automatically to the previous SHA on failure.
5. Verify: open `https://<APP_DOMAIN>`, log in, open the dashboard; check `https://<APP_DOMAIN>/api/health` returns `{"status":"ok","db":"ok","version":"<sha>"}`.

Manual path (Actions unavailable):

1. Build and push images from a workstation: `docker build -f apps/api/Dockerfile -t ghcr.io/mhamad-raad/pallet-api:<sha> . && docker push …` (same for `deploy/caddy/Dockerfile`).
2. `ssh <user>@<vps>` then `sudo /opt/pallet/deploy/deploy.sh <sha>`.

## A failed migration

`deploy.sh` rolls the images back and prints the path of the dump it took just before the migration. The previous version then runs again, but the database may hold part of the failed migration: Prisma does not wrap a migration in one transaction, and it records the failure in `_prisma_migrations`, so every later `migrate deploy` stops with `P3009` until the failure is resolved.

1. See where it stands: `cd /opt/pallet && docker compose --profile migrate run --rm migrate node_modules/.bin/prisma migrate status`. It names the failed migration.
2. Choose one way out:
   - **Put the database back as it was (safest).** The API was stopped before the dump, so it holds everything written up to the deploy. Restore it into a side database and swap it in, as `restore-from-backup.md` does:

     ```bash
     cd /opt/pallet
     docker compose stop caddy api
     docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
       -c "CREATE DATABASE pallet_premigrate OWNER pallet_owner ENCODING 'UTF8' TEMPLATE template0;"
     docker compose exec -T postgres pg_restore -U pallet_owner -d pallet_premigrate --exit-on-error \
       < /var/backups/pallet/pre-migrate/pre-migrate-<time>-<sha>.dump
     ```

     Give `pallet_premigrate` the database settings of `deploy/postgres/init/01-roles.sh` (the `psql` block in `deploy/backup/restore.sh` step 5, with that name), then rename `pallet` → `pallet_failed_migration` and `pallet_premigrate` → `pallet` (terminate the connections first, as "Undo a restore" shows), run `docker compose --profile migrate run --rm migrate` with the previous version checked out, and `docker compose up -d`. The failed migration is simply not recorded there; no `migrate resolve` is needed. Drop `pallet_failed_migration` once the app is verified (`reconcile.js` prints `0 differences`).

   - **Finish or undo it by hand** (only when `migrate status` and the migration's SQL make clear what ran). Undo what the migration applied, then `docker compose --profile migrate run --rm migrate node_modules/.bin/prisma migrate resolve --rolled-back <migration_name>`; or, if you completed the rest by hand exactly as the file says, `… migrate resolve --applied <migration_name>`.
3. Fix the migration in a new commit (never edit one that ran anywhere), let CI pass, and deploy again.

Rules:

- Migrations must be expand-only for one release (add columns/tables; drop only in the release after the code stops using them). This keeps rollback safe.
- A short restart is acceptable (zero downtime is not required). Deploy outside factory working hours when possible.

One-time VPS prerequisites: `/opt/pallet` is a git clone of the repository; `/opt/pallet/.env` exists (from `.env.example`); `docker login ghcr.io` done with a classic GitHub token that has only `read:packages` and an expiry you have written down (`rotate-secrets.md`, "GHCR token") — or both GHCR packages set to public; GitHub repository secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_HOST_FINGERPRINT` and environment `production` exist; the backup bucket has Object Lock and the VPS an append-only key (`backup-keys.md`).

Repository settings (by hand, GitHub → Settings → Environments → `production`): add yourself as a required reviewer, and under "Deployment branches and tags" allow only `main` and tags matching `v*`. The workflow also refuses any other ref on its own (ARCHITECTURE.md Q76).

Servers set up before 2026-09-26 gave the owner role `CREATEDB`, which production never needs. Remove it once: `docker compose exec -T postgres psql -U postgres -c "ALTER ROLE pallet_owner NOCREATEDB;"`.
