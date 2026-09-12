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
- **M1 done; in progress: Milestone M2** — catalogue (uploads, settings, items, stock, customers, drivers). Work in the iterations of `docs/iterations.md`; each milestone must end runnable with its §15 acceptance checklist green.
- **1a done** (2026-09-12): `Clock`, `RequestContext` + middleware, `AuditService.record` with `toAuditSnapshot` / `redactAuditSnapshot`, the permission-declaration startup check, the bundled common-password list, the §7.10 i18n key rename, and the integration harness (`test/global-setup.ts`, `test/helpers/`) with the first integration test.
- **1b done** (2026-09-12): password service + policy (bundled list), login throttle with (ip, username) backoff, session families with rotation / 30 s grace / reuse detection, the five global guards in their fixed order, `/api/auth/login|refresh|logout|logout-all|me|change-password`, and the S-1 … S-9, S-16 … S-18, S-20, S-21 integration tests.
- **1c done** (2026-09-12): `/api/users` (list, create, get, patch, permissions, reset-password, logout-all) with the self, last-admin and version guards, `GET /api/audit-logs` with per-viewer cost redaction, `lockUser` / `lockActiveAdmins`, and the S-10, S-11, S-13 … S-16 integration tests.
- **1d done** (2026-09-12): web auth shell — `api-client` (refresh-once-and-retry, Web Locks cross-tab serialisation), in-memory auth store, route guards, `/login`, `/change-password`, the permission-filtered `_app` shell, `/users*`, `/account`, `/history`, the UI primitives those pages need, and the full ckb/ar/en key set (301 keys) with a completeness test over every error code, validation code, enum value and permission key.
- **M1 acceptance walked end to end** on the dev stack: first admin signs in → every other route answers `PASSWORD_CHANGE_REQUIRED` → password changed → employee created → permissions granted and revoked → all six actions appear in `/history`.
- **M1 reviewed end to end** (`9e70b91`): body limits, `MaintenanceService`, the login/reset race, cache clearing on sign-out and the missing §7.3.19/§7.3.21 controls were fixed.
- **2a done** (`9d98578`): uploads (Q35 pipeline, per-user `UploadThrottleGuard`, public serving) and factory settings (Q36 no-op save), web `apiUpload`, `ImageUploadField`, `/settings`.
- **2b done**: `StockLedger.apply` (the only writer of `quantity_on_hand`), `lockItems` / `lockBatch`, items (CRUD-as-archive, initial batch, stock adjustments, ledger listing with `balanceAfter`, derived `quantityOut` / `damagedTotal`) and purchase batches (soft delete, cost stripping); Q37 makes an unchanged item or batch PATCH a no-op. API only — the pages come in 2d.
- Still open from M1: S-12 (permission denial over the whole endpoint catalogue) needs 2c; S-14 is covered by 2b's purchase-batch tests; `/history` gains its date-range filter with the shared `DatePicker` in 2d.
- Carried into 1d: `errors.<CODE>` / `validation.<code>` i18n keys (added with the web error rendering), and deleting the `home.*` / `status.*` scaffold keys with the baseline home page.

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
