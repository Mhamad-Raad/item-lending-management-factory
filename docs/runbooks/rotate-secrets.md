# Runbook — rotate secrets

Always: update the password manager entry FIRST, then the server. Generate each value as its section says:
`openssl rand -hex 64` (128 characters) for `JWT_ACCESS_SECRET`, which must be at least 64 characters; `openssl rand -hex 32`
(64 characters) for everything else — hex keeps the database passwords safe inside `DATABASE_URL`s.

## JWT_ACCESS_SECRET (effect: every access token becomes invalid; tabs silently refresh via the cookie)

1. Generate it with `openssl rand -hex 64` (the API refuses a placeholder, a repository value or a predictable one at startup, and `deploy.sh` refuses the same before switching versions, Q67). Edit `/opt/pallet/.env` → new `JWT_ACCESS_SECRET`.
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

There are two keys (Q70, `backup-keys.md`): the VPS's **append-only** key (no `deleteFiles`) in `/etc/pallet/backup.env`, and the **prune** key (with `deleteFiles`) in `~/.config/pallet/prune.env` on the maintainer's machine. Create each new key with the B2 CLI exactly as `backup-keys.md` shows (the web console cannot leave out `deleteFiles`), update its file and the password manager, run `backup.sh` (VPS key) or `prune.sh` (prune key) once, then delete the old key.

## Deploy SSH key

Replace `VPS_SSH_KEY` in GitHub secrets and `~/.ssh/authorized_keys` on the VPS.

## GHCR token (the VPS pulls the images with it)

The VPS's `docker login ghcr.io` uses a **classic** personal access token with only `read:packages` (GitHub's fine-grained
tokens do not cover the container registry). Classic tokens can expire: create it with an expiry of one year at most, put the
expiry date in the password manager entry **and in your calendar a month before**, and on renewal run
`docker login ghcr.io -u <github-user>` on the VPS with the new token (it is stored in `~/.docker/config.json` of the user that
runs `deploy.sh`). An expired token shows up as the next deploy failing at `docker compose pull` with `denied` or
`unauthorized` — the running version is not affected, and `deploy.sh` rolls back. Setting both GHCR packages to public removes
the token altogether (the repository is public already).

Schedule: rotate every secret yearly and immediately after any suspected leak or maintainer laptop loss.
