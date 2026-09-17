# Documentation

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — the complete build specification (single source of truth).
- [`iterations.md`](iterations.md) — how §15 is cut into iterations, and the ritual each one follows.
- `rtl-audit.md` — shadcn/ui RTL audit checklist and colour-contrast ratios (created in milestone M6, ARCHITECTURE.md §7.11–7.12).

## Runbooks

Short, step-by-step procedures for the maintainer (ARCHITECTURE.md §13).

| Runbook                                                         | When                                               |
| --------------------------------------------------------------- | -------------------------------------------------- |
| [incident-triage.md](runbooks/incident-triage.md)               | An alert fired or the site is down: where to start |
| [deploy.md](runbooks/deploy.md)                                 | Deploy a new version                               |
| [rollback.md](runbooks/rollback.md)                             | Go back to the previous version                    |
| [restore-from-backup.md](runbooks/restore-from-backup.md)       | Restore the database and uploads from off-site     |
| [quarterly-restore-test.md](runbooks/quarterly-restore-test.md) | Quarterly "fresh VPS from off-site material" test  |
| [rotate-secrets.md](runbooks/rotate-secrets.md)                 | Rotate JWT secret, DB passwords, backup key        |
| [manage-users.md](runbooks/manage-users.md)                     | Add, deactivate or reset a user                    |
| [unlock-account.md](runbooks/unlock-account.md)                 | Clear a login lockout                              |
| [last-admin-recovery.md](runbooks/last-admin-recovery.md)       | Every admin is locked out (direct DB procedure)    |
| [upgrade-node-postgres.md](runbooks/upgrade-node-postgres.md)   | Upgrade Node.js LTS or PostgreSQL major version    |
