# Pallet System

Pallet lending, stock, deposits (insurance) and returns for a single pallet factory.
Web app for 2–5 admins and 5–10 employees; UI in Kurdish Sorani (default), Arabic and English.

> **Status: baseline.** This repository contains the project baseline (workspace, tooling, database schema,
> shared business rules, API and web shells, Docker/CI setup). Features are built milestone by milestone
> following [`ARCHITECTURE.md`](./ARCHITECTURE.md) section 15.

## Stack

| Layer    | Choice                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------- |
| Monorepo | pnpm workspace — `apps/web`, `apps/api`, `packages/shared`                                                |
| Web      | Vite + React 19, TanStack Router/Query, react-hook-form + zod, Tailwind CSS 4, shadcn/ui, i18next, motion |
| API      | NestJS 11, Prisma 7, PostgreSQL 18                                                                        |
| Deploy   | Docker Compose on one VPS behind Caddy (automatic HTTPS)                                                  |

Exact versions and the reasons behind them are in `ARCHITECTURE.md` §1 and §2.

## Prerequisites

- Node.js 24 LTS (`.nvmrc`) with Corepack (`corepack enable` once — provides the pinned pnpm)
- Docker (for PostgreSQL in development)

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env          # then fill in the development values
pnpm db:up                    # PostgreSQL on 127.0.0.1:5432 (roles are created on first start)
pnpm db:migrate               # apply migrations as the owner role
pnpm --filter @pallet/api build && pnpm db:seed   # first admin + default settings
pnpm dev                      # API on :3000, web on http://localhost:5173 (proxies /api)
```

## Everyday commands

| Command                 | What it does                                    |
| ----------------------- | ----------------------------------------------- |
| `pnpm dev`              | Shared package watch + API (watch) + web (Vite) |
| `pnpm build`            | Build every package                             |
| `pnpm lint`             | ESLint over the whole repo                      |
| `pnpm typecheck`        | TypeScript strict check of every package        |
| `pnpm test`             | Unit tests (Vitest)                             |
| `pnpm test:integration` | API integration tests against a real PostgreSQL |
| `pnpm test:e2e`         | Playwright smoke tests                          |
| `pnpm format`           | Prettier                                        |

## Repository layout

```
apps/api          NestJS API (Prisma schema and migrations in apps/api/prisma)
apps/web          React web app
packages/shared   zod schemas, enums, permission keys, error codes, business-rule math
deploy/           Caddy, PostgreSQL init, backup and deploy scripts
docs/runbooks/    Step-by-step operational runbooks
```

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the complete build specification (data model, business rules,
  API, frontend, security, deployment, testing, build order).
- [`docs/runbooks/`](./docs/runbooks) — deploy, rollback, restore, secret rotation, user management.
