# CLAUDE.md — Pallet System

Project memory for agents working in this repository. Read this first, then the relevant sections of `ARCHITECTURE.md`.

## What this is

Pallet System: a web app for a single pallet factory in Iraq (Kurdistan Region) that **lends** pallets to customer companies against an insurance deposit (IQD), records returns (accepted / damaged), payments and refunds, and tracks stock. 2–5 admins, 5–10 employees. UI in Kurdish Sorani (default, RTL), Arabic (RTL) and English.

## Source of truth

- **`ARCHITECTURE.md`** is the complete, normative build specification (16 sections). Build exactly what it says; do not add features beyond it (ideas go to §16 "Suggested future improvements").
- Ambiguities were resolved as defaults in **§2 (A1–A17, Q1–Q32)** — follow them; if something is still unclear, add a new Q item to §2 with the default you chose rather than guessing silently.
- Canonical files the document mirrors — change the file and the document **in the same commit**:
  - `apps/api/prisma/schema.prisma` (database), `apps/api/prisma/sql/constraints.sql`, `apps/api/prisma/sql/grants.sql`
  - `packages/shared/src/permissions.ts`, `error-codes.ts`, `enums.ts`, `domain/ledger-math.ts`
- The original client brief is `~/Desktop/architecture-query.md` (not in the repo).

## Status

- **Baseline (M0) is done** (2026-09-11): workspace, tooling, Prisma schema + initial migration, grants, role init, shared package (enums, permissions, error codes, dates, ledger math with all worked-example tests, `schemas/common.ts`), API shell (env validation, Prisma service, pino logs, error filter, access decorators, `/api/health`, migrate/seed, healthcheck, reconcile scripts), web shell (Vite, TanStack Router, preferences boot, i18n ckb/ar/en, Tailwind tokens, Button), Docker/Caddy/CI/backups/runbooks.
- **In progress: Milestone M1** — auth + users/permissions + audit log. Work in the iterations of `docs/iterations.md` (1a → 1d); each milestone must end runnable with its §15 acceptance checklist green.
- **1a done** (2026-09-12): `Clock`, `RequestContext` + middleware, `AuditService.record` with `toAuditSnapshot` / `redactAuditSnapshot`, the permission-declaration startup check, the bundled common-password list, the §7.10 i18n key rename, and the integration harness (`test/global-setup.ts`, `test/helpers/`) with the first integration test.
- Next: **1b** — password, login-throttle and session services, the five global guards, `/api/auth/*`. `home.*` and `status.*` i18n keys still exist and are deleted in 1d when the baseline home page is replaced.

## Layout

```
apps/api          NestJS 11 API (CommonJS). prisma/ = schema, migrations, sql/. src/scripts/ = migrate, healthcheck, reconcile
apps/web          React 19 + Vite 8 + TanStack Router (file routes in src/routes). public/boot-prefs.js applies prefs before paint
packages/shared   ESM package built to dist/ (tsc -b): enums, permissions, error codes, dates, ledger math, zod schemas
deploy/           Caddy (+ Dockerfile building the web app), postgres/init roles script, backup/restore, deploy.sh
docs/runbooks/    Operational runbooks
```

## Commands

pnpm comes from corepack (`corepack enable --install-directory ~/.local/bin` was run once; `~/.local/bin` is on PATH — the default `/usr/local/bin` needs sudo). Docker runs through colima. Local ports: Postgres 5434, API 3000, Vite 5175 (ARCHITECTURE.md Q33).

| Command                                                                     | Purpose                                                     |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm install`                                                              | Install (runs `prisma generate` for the API)                |
| `pnpm db:up` / `pnpm db:down`                                               | Dev Postgres on 127.0.0.1:5434 (also creates `pallet_test`) |
| `pnpm db:migrate`                                                           | `migrate dev` + grants (development only)                   |
| `pnpm db:deploy`                                                            | `migrate deploy` + grants (CI / non-interactive)            |
| `pnpm --filter @pallet/api build && pnpm db:seed`                           | First admin + default settings                              |
| `pnpm dev`                                                                  | Shared watch + API (:3000) + web (:5175, proxies `/api`)    |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm format` | Quality gates (all must pass)                               |
| `pnpm test:integration`                                                     | API integration tests against real Postgres                 |
| `pnpm test:e2e`                                                             | Playwright (Chromium)                                       |

Local `.env` lives at the **repository root** (copy the LOCAL DEVELOPMENT block of `.env.example`).

## Rules that are easy to break

- **Pinned majors — do not bump without re-checking:** NestJS **11** (`@nestjs/throttler` and `@sentry/nestjs` peer only ≤ 11), TypeScript **6.0** (typescript-eslint supports < 6.1), Prisma **7.10** (8 was RC). Dependabot PRs for these majors must not be merged blindly. Exact versions everywhere (`save-exact`).
- **Money** is whole IQD: `bigint` in PostgreSQL, safe-integer `number` in TypeScript (convert only via `toSafeMoney` / `toDbMoney`). Every raw SQL `SUM()` of money is cast `::bigint`.
- **Ledgers are append-only:** `stock_movements`, `ledger_entries`, `audit_logs`, `return_lines` are never updated or deleted (DB grants + triggers enforce it); corrections are reversing rows. `returns` may only have its reversal columns set once. `items.quantity_on_hand` changes only together with stock movements.
- **Maintained order totals** (`orders.status/owed/held/...`, `order_lines.out_quantity/...`) are written only by `recomputeOrder()` using `packages/shared` ledger math — never incrementally. `pnpm --filter @pallet/api reconcile` (after a build) must report 0 discrepancies.
- **Locks:** check-then-write operations use `SELECT … FOR UPDATE` in the fixed order customer → order → items (sorted by id) → counter, inside one interactive Prisma transaction; never SERIALIZABLE. Raw SQL only through `$queryRaw` tagged templates (ESLint blocks the `Unsafe` variants).
- **API errors are codes, never prose** (`ApiError('CODE')`, catalogue in `error-codes.ts`); the web maps them to `errors.<CODE>` i18n keys.
- **Permissions** are read from the database on every request; every route handler carries exactly one access decorator (`@Public`, `@Authenticated`, `@AdminOnly`, `@RequirePermission`, `@RequireAnyPermission`).
- **Dates:** business dates are `YYYY-MM-DD` in Asia/Baghdad; timestamps UTC; UI always displays Asia/Baghdad, `dd/MM/yyyy`, Western digits.
- **i18n:** every key must exist in `ckb.json`, `ar.json` and `en.json`; no Latin text in ckb/ar (a test enforces it). Use logical CSS (`ms-`, `pe-`, `start`/`end`), never `left`/`right`.
- **Security:** no `dangerouslySetInnerHTML`; no secrets in the repo or logs; only Caddy publishes ports in `docker-compose.yml`. The GitHub repo is **public**.
- **Migrations:** never edit an applied migration; add a new one. Raw SQL that Prisma cannot express goes into the migration and is mirrored in `prisma/sql/`.

## Git

- Branch `main`, remote `origin` = `github.com/Mhamad-Raad/item-lending-management-factory`. Work happens on `feat/<id>-<slug>` branches, one per iteration (`docs/iterations.md`).
- Husky pre-commit runs lint-staged (ESLint + Prettier check on staged files) and `pnpm typecheck` — keep it green rather than bypassing it.
- **Review before commit, always**: `/code-review high` on the branch _and_ a read of the diff. An iteration is not finished without it (`docs/iterations.md`, step 6).
- Clean commits: green tree at every commit, one concern per commit, nothing generated or local (`.env`, `dist/`) staged, no unrelated formatting churn.
- Commit messages: imperative subject ≤ 72 chars without a trailing period, blank line, then a body explaining **why** (wrapped ~78 cols). No emoji.
- **Never credit a tool or an assistant** in a commit message or pull request — no `Co-Authored-By` for an agent, no "generated with" footer. The maintainer is the author.
- Never rewrite pushed history; amend only local commits.
- `ARCHITECTURE.md` and migrations are excluded from Prettier.
