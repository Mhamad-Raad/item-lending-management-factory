# Runbook — restore from backup

Inputs: `/etc/pallet/backup.env` (restic repository + password + bucket keys, from the password manager) and a running Docker host with `/opt/pallet` cloned and `/opt/pallet/.env` present. The append-only VPS key can read and restore; it cannot delete (Q70).

If the old server was compromised, first follow "If the VPS was compromised" in `backup-keys.md`: rotate its key and bring back any snapshots the attacker hid.

1. List snapshots: `sudo bash -c 'source /etc/pallet/backup.env && export RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY && restic snapshots --tag pallet'`.
2. Pick a snapshot id (or `latest`).
3. Check there is room for a second copy of the database and a dump of it: `df -h /var/lib/docker /var/backups`. The script keeps the current database until you drop it.
4. Run `sudo /opt/pallet/deploy/backup/restore.sh --yes <snapshot-id>`. The script (Q83):
   1. restores the snapshot into `/var/restore/pallet-<timestamp>`;
   2. stops `caddy` and `api`;
   3. starts `postgres` (on an empty volume the init script creates `pallet_owner`, `pallet_app` and the `pallet` database);
   4. dumps the current `pallet` database to `/var/backups/pallet/pre-restore-<timestamp>.dump` (a safety copy);
   5. restores the snapshot into a new database `pallet_restore`, gives it the database settings of `01-roles.sh`, and checks it holds applied migrations and an active admin — if not, it stops here and `pallet` is untouched;
   6. swaps the names: `pallet` becomes `pallet_before_<timestamp>` (kept) and `pallet_restore` becomes `pallet`;
   7. copies the current uploads to `/var/restore/pallet-<timestamp>/uploads-before`, then the snapshot's uploads into the `pallet_uploads` volume;
   8. runs the `migrate` service (re-applies grants, applies any newer migrations) and starts everything.

   Every step until the swap leaves `pallet` exactly as it was; if the script stops there, `cd /opt/pallet && docker compose up -d` brings the app back on the old data. The script says which case applies.

5. Verify: `docker compose exec -T api node --max-old-space-size=256 dist/scripts/reconcile.js` prints `0 differences`; log in; open three recent orders and the dashboard; open one item image.

## After a restore

Once the restored data is verified (and not before):

- Drop the previous database: `docker compose exec -T postgres psql -U postgres -d postgres -c 'DROP DATABASE pallet_before_<timestamp>;'` (the name the script printed).
- Delete `/var/restore/pallet-<timestamp>` and `/var/backups/pallet/pre-restore-<timestamp>.dump`: both contain unencrypted data.

## Undo a restore

If the restored data turns out to be the wrong snapshot while `pallet_before_<timestamp>` still exists:

```bash
cd /opt/pallet
docker compose stop caddy api
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'pallet' AND pid <> pg_backend_pid();" \
  -c "ALTER DATABASE pallet RENAME TO pallet_wrong_restore;" \
  -c "ALTER DATABASE pallet_before_<timestamp> RENAME TO pallet;"
sudo rsync -a --delete /var/restore/pallet-<timestamp>/uploads-before/ "$(docker volume inspect pallet_uploads --format '{{ .Mountpoint }}')/"
docker compose up -d
```

Then drop `pallet_wrong_restore`. If the previous database was already dropped, restore `/var/backups/pallet/pre-restore-<timestamp>.dump` the same way into a new database (`pg_restore -U pallet_owner -d <new database> --exit-on-error`) and swap it in as above.

The application must run the same or a newer version than the one that produced the dump.

To rehearse the script without a server, `APP_DIR`, `BACKUP_ENV_FILE`, `RESTORE_ROOT` and `SAFETY_DIR` can point at a scratch compose project, with a `restic` stub on `PATH`.
