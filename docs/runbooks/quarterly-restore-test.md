# Runbook — quarterly restore test ("fresh VPS from off-site material only")

Goal: prove the system can be rebuilt using ONLY the git repository and the password-manager escrow. Do it every quarter (January, April, July, October). Record the result in the table at the bottom.

Checklist:

- [ ] 1. Create a temporary Ubuntu 24.04 VPS (smallest size). Do NOT copy anything from the production server.
- [ ] 2. Install Docker Engine + compose plugin, `restic`, `git`, `rsync` (`apt install restic git rsync`).
- [ ] 3. `git clone https://github.com/Mhamad-Raad/item-lending-management-factory.git /opt/pallet`; `git checkout <production APP_VERSION>`.
- [ ] 4. From the password manager only: write `/opt/pallet/.env` (production values, `APP_DOMAIN` = a test hostname) and `/etc/pallet/backup.env`.
- [ ] 5. `docker login ghcr.io` and `docker compose pull`.
- [ ] 6. `sudo /opt/pallet/deploy/backup/restore.sh --yes latest`.
- [ ] 7. `docker compose exec -T api node dist/scripts/reconcile.js` → `0 differences`.
- [ ] 8. Log in as an admin; compare dashboard totals, the newest order number and one customer's owed/held with production.
- [ ] 9. Open an item image and the receipt of the newest order.
- [ ] 10. Destroy the temporary VPS; delete its DNS record.
- [ ] 11. Note duration and problems below; fix the runbooks if any step was unclear.

| Date | Snapshot | Duration | Result | Notes |
| ---- | -------- | -------- | ------ | ----- |
