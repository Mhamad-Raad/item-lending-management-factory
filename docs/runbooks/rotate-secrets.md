# Runbook — rotate secrets

Always: generate with `openssl rand -hex 32`, update the password manager entry FIRST, then the server.

## JWT_ACCESS_SECRET (effect: every access token becomes invalid; tabs silently refresh via the cookie)

1. Edit `/opt/pallet/.env` → new `JWT_ACCESS_SECRET`.
2. `cd /opt/pallet && docker compose up -d api`.

## DB_APP_PASSWORD (runtime role)

1. `docker compose exec -T postgres psql -U postgres -c "ALTER ROLE pallet_app PASSWORD '<new>';"`
2. Edit `.env` → `DB_APP_PASSWORD=<new>`; `docker compose up -d api`.

## DB_OWNER_PASSWORD (migration role)

1. `docker compose exec -T postgres psql -U postgres -c "ALTER ROLE pallet_owner PASSWORD '<new>';"`
2. Edit `.env` → `DB_OWNER_PASSWORD=<new>`. Next deploy uses it.

## POSTGRES_PASSWORD (superuser)

1. `docker compose exec -T postgres psql -U postgres -c "ALTER ROLE postgres PASSWORD '<new>';"`
2. Edit `.env`. (The env value only matters on a fresh volume.)

## Backup encryption key (RESTIC_PASSWORD)

1. `restic key add` (enter the new password), verify `restic snapshots` works with it.
2. `restic key list`; `restic key remove <old-key-id>`.
3. Update `/etc/pallet/backup.env` and the password manager.

## Bucket keys (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)

Create a new bucket-scoped key in the provider console, update `/etc/pallet/backup.env`, run `backup.sh` once by hand, then delete the old key.

## Deploy SSH key / GHCR token

Replace `VPS_SSH_KEY` in GitHub secrets and `~/.ssh/authorized_keys` on the VPS; re-run `docker login ghcr.io` with a new `read:packages` token.

Schedule: rotate every secret yearly and immediately after any suspected leak or maintainer laptop loss.
