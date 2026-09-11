# Runbook — restore from backup

Inputs: `/etc/pallet/backup.env` (restic repository + password + bucket keys, from the password manager) and a running Docker host with `/opt/pallet` cloned and `/opt/pallet/.env` present.

1. List snapshots: `sudo bash -c 'source /etc/pallet/backup.env && export RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY && restic snapshots --tag pallet'`.
2. Pick a snapshot id (or `latest`).
3. Run `sudo /opt/pallet/deploy/backup/restore.sh --yes <snapshot-id>`. The script:
   1. restores the snapshot into `/var/restore/pallet-<timestamp>`;
   2. stops `caddy` and `api`;
   3. starts `postgres` (on an empty volume the init script creates `pallet_owner`, `pallet_app` and the `pallet` database);
   4. drops and recreates the `pallet` database and runs `pg_restore`;
   5. copies the uploads back into the `pallet_uploads` volume;
   6. runs the `migrate` service (re-applies grants, applies any newer migrations) and starts everything.
4. Verify: `docker compose exec -T api node dist/scripts/reconcile.js` prints `0 differences`; log in; open three recent orders and the dashboard; open one item image.
5. Delete `/var/restore/pallet-<timestamp>` after verification (it contains unencrypted data).

The application must run the same or a newer version than the one that produced the dump.
