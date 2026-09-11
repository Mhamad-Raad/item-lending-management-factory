# Runbook — upgrade Node.js, PostgreSQL and major libraries

## Node.js (yearly; move to the new LTS after its first October as Active LTS)

1. Branch. Replace `24.21.0` everywhere: `apps/api/Dockerfile`, `deploy/caddy/Dockerfile`, `.github/workflows/ci.yml` (`NODE_VERSION`), `.nvmrc`, root `package.json` `engines`, `@types/node` major.
2. `pnpm install`, `pnpm build && pnpm test && pnpm test:integration && pnpm test:e2e` locally and in CI.
3. Deploy normally. Rollback = previous SHA (images contain the runtime).

## PostgreSQL minor (18.x → 18.y): change the image tag in both compose files and CI; deploy; `docker compose up -d postgres`. No data migration.

## PostgreSQL major (18 → 19+): dump/restore (never mount an old data directory in a new major)

1. Announce downtime; take a fresh backup (`deploy/backup/backup.sh`) and verify it.
2. `docker compose stop caddy api`.
3. `docker compose exec -T postgres pg_dump -U pallet_owner -d pallet -Fc > /var/backups/pallet/pre-upgrade.dump`.
4. Keep a copy of the old data volume (Docker cannot rename volumes): `docker compose stop postgres && docker run --rm -v pallet_pgdata:/from:ro -v pallet_pgdata_pg18:/to alpine:3.22 cp -a /from/. /to/`, then `docker compose rm -f postgres && docker volume rm pallet_pgdata`.
5. Change the image tag to the new major in `docker-compose.yml`, `docker-compose.dev.yml`, CI; `docker compose up -d postgres` (init script recreates roles on the empty volume).
6. `docker compose exec -T postgres pg_restore -U pallet_owner -d pallet --exit-on-error < /var/backups/pallet/pre-upgrade.dump`.
7. `docker compose --profile migrate run --rm migrate && docker compose up -d`; run `node dist/scripts/reconcile.js`.
8. Keep `pallet_pgdata_pg18` for 30 days, then remove it.

## Major library upgrades (NestJS 12, TypeScript 7, Prisma 8)

Pinned deliberately (ARCHITECTURE.md §13.9). Upgrade one at a time on a branch, only when their peers support it (`npm view <pkg> peerDependencies`), read the migration guide, run the full test suite, deploy.
