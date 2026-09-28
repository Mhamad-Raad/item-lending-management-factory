# Jiyan Items (Pallet System)

Pallet lending, stock, deposits (insurance) and returns for one pallet factory, branded **Jiyan Items** —
کاڵاکانی ژیان · أصناف جيان. Web app for 2–5 admins and 5–10 employees; UI in Kurdish Sorani (default, right to
left), Arabic and English. Built to run for years on one server with about one update a year.

| Layer    | Choice                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------- |
| Monorepo | pnpm workspace — `apps/web`, `apps/api`, `packages/shared`                                                |
| Web      | Vite + React 19, TanStack Router/Query, react-hook-form + zod, Tailwind CSS 4, shadcn/ui, i18next, motion |
| API      | NestJS 11, Prisma 7, PostgreSQL 18                                                                        |
| Deploy   | Docker Compose on one Ubuntu VPS behind Caddy (automatic HTTPS); nightly encrypted off-site backups       |

## Maintainer quick start

**What it is.** A single-page web app (`apps/web`) talking to a REST API (`apps/api`) over PostgreSQL. Money is
whole Iraqi dinars; stock and money are append-only ledgers, so balances are always the sum of their history and
every change is in the History page. Production is three containers — `caddy`, `api`, `postgres` — in
`/opt/pallet` on the VPS.

**Prerequisites (your machine).** Node.js 24 LTS (`.nvmrc`) with Corepack enabled once
(`corepack enable --install-directory ~/.local/bin`, or `corepack enable` with sudo); Docker; for backups, `restic`
and `jq`. The server needs only Docker and the one-time setup in `ARCHITECTURE.md` §13.4.

**Run it locally.**

```bash
pnpm install
sed -n '/^# NODE_ENV=development/,$p' .env.example | sed 's/^# //' > .env   # the LOCAL DEVELOPMENT block
pnpm db:up && pnpm db:migrate                                               # PostgreSQL on 127.0.0.1:5434
pnpm --filter @pallet/api build && pnpm db:seed                             # first admin + settings
pnpm dev                                                                    # web on http://localhost:5175
```

**Test.** `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`, then
`pnpm test:integration` (real PostgreSQL), `pnpm test:e2e` (browser, mocked API) and `pnpm test:e2e:live`
(browser against the built API). All must be green before anything is merged; Husky checks lint and types on
every commit.

**Deploy.** Merge to `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`; the `Deploy` workflow runs CI,
builds the images and runs `deploy.sh` on the server, which dumps the database, migrates, and rolls back by itself
if the new version is not healthy within a minute. Details, the manual path and a failed migration:
[`docs/runbooks/deploy.md`](docs/runbooks/deploy.md). Going back: [`rollback.md`](docs/runbooks/rollback.md).

**Restore.** Backups run nightly on the server (`deploy/backup/backup.sh` → restic → Backblaze B2); you prune them
monthly from your own machine (`deploy/backup/prune.sh`). To restore:
[`restore-from-backup.md`](docs/runbooks/restore-from-backup.md). Something is down: start at
[`incident-triage.md`](docs/runbooks/incident-triage.md).

**Recover.** No admin can sign in: on the server,
`docker compose --profile migrate run --rm migrate node dist/scripts/recover-admin.js <username>`
([`last-admin-recovery.md`](docs/runbooks/last-admin-recovery.md)). One person locked out by wrong passwords:
[`unlock-account.md`](docs/runbooks/unlock-account.md). All runbooks: [`docs/README.md`](docs/README.md).

**Where the rules live.** [`ARCHITECTURE.md`](ARCHITECTURE.md) is the normative specification; every decision
taken since is a `Q` item in its §2, newest last. [`CLAUDE.md`](CLAUDE.md) lists the rules that are easy to break
and the commands; [`docs/CHANGELOG.md`](docs/CHANGELOG.md) is how it was built.

### Top 10 traps

1. **Pinned majors.** NestJS 11, TypeScript 6.0 (typescript-eslint supports < 6.1), Prisma 7: never merge a
   Dependabot major (or a TypeScript minor) without the upgrade runbook.
2. **Ledgers are append-only.** Never `UPDATE`/`DELETE` `stock_movements`, `ledger_entries`, `audit_logs` or
   `return_lines` — the database refuses, and a correction is a reversing row made through the app.
3. **Never edit an applied migration**; add a new one, and keep it expand-only for one release (rollback relies on
   it).
4. **Money is whole dinars** as integers — never floating point, never a `SUM()` without `::bigint`.
5. **The `.env` files are the keys to everything** (`/opt/pallet/.env`, `/etc/pallet/backup.env`,
   `~/.config/pallet/prune.env`): keep every value in the password manager; losing `RESTIC_PASSWORD` loses every
   backup.
6. **Never run `prune.sh` on the server**, and never give the server a bucket key that can delete.
7. **`deploy.sh` refuses placeholder secrets** — generate real ones (`rotate-secrets.md`); do not bypass it.
8. **Every text in three languages** (`ckb.json`, `ar.json`, `en.json`) and no Latin letters in the Sorani and
   Arabic files — a test fails otherwise. Use logical CSS (`ms-`, `pe-`, `start`), never left/right.
9. **Every API route needs exactly one access decorator**, and errors are codes, never sentences.
10. **`pnpm --filter @pallet/api reconcile` must print 0 differences** after any data repair — if it does not,
    stop and investigate before anyone keeps working.

### Yearly checklist

- [ ] **Dependencies, within the pinned majors:** merge the Dependabot patch/minor PRs (CI green), then
      `pnpm audit --audit-level=high`; read `upgrade-node-postgres.md` before any major.
- [ ] **End-of-life dates:** Node.js 24 LTS ends **30 April 2028** (move to the next LTS from its first October as
      Active LTS); PostgreSQL 18 ends **November 2030**; Ubuntu 24.04 standard support ends **April 2029**; the
      images' Debian 13 gets security updates to about **mid-2028**. Plan each upgrade a year ahead.
- [ ] **Certificates and tokens:** HTTPS renews itself (Caddy) — check that expiry mails still reach `ACME_EMAIL`;
      renew the server's GHCR token before its expiry date (`rotate-secrets.md`, "GHCR token"); rotate the other
      secrets as that runbook says.
- [ ] **Backups:** run the restore drill ([`quarterly-restore-test.md`](docs/runbooks/quarterly-restore-test.md) —
      quarterly is the goal, yearly the minimum); confirm the healthchecks.io backup and prune checks are green;
      check the B2 Object Lock and keys still match [`backup-keys.md`](docs/runbooks/backup-keys.md).
- [ ] **Access:** in Users, deactivate people who left; make sure at least two admins can sign in.

## Repository layout

```
apps/api          NestJS API (Prisma schema and migrations in apps/api/prisma; scripts in src/scripts)
apps/web          React web app
packages/shared   zod schemas, enums, permission keys, error codes, business-rule math
deploy/           Caddy, PostgreSQL init, backup/prune/restore and deploy scripts
docs/             Runbooks, changelog, iteration plan, RTL audit
```
