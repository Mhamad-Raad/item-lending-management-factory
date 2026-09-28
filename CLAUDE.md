# CLAUDE.md — Pallet System

Project memory for agents working in this repository. Read this first, then the relevant sections of `ARCHITECTURE.md`.

## What this is

Pallet System: a web app for a single pallet factory in Iraq (Kurdistan Region) that **lends** pallets to customer companies against an insurance deposit (IQD), records returns (accepted / damaged), payments and refunds, and tracks stock. 2–5 admins, 5–10 employees. UI in Kurdish Sorani (default, RTL), Arabic (RTL) and English.

## Source of truth

- **`ARCHITECTURE.md`** is the complete, normative build specification (16 sections). Build exactly what it says; do not add features beyond it (ideas go to §16 "Suggested future improvements").
- Ambiguities were resolved as defaults in **§2 (A1–A17, Q1 onward)** — follow them; if something is still unclear, add a new Q item to §2 with the default you chose rather than guessing silently.
- Canonical files the document mirrors — change the file and the document **in the same commit**:
  - `apps/api/prisma/schema.prisma` (database), `apps/api/prisma/sql/constraints.sql`, `apps/api/prisma/sql/grants.sql`
  - `packages/shared/src/permissions.ts`, `error-codes.ts`, `enums.ts`, `domain/ledger-math.ts`
- The original client brief is `~/Desktop/architecture-query.md` (not in the repo).

## Status

- **Current state (2026-09-28, after 8b):** the whole of §15 (M0–M7) is built, reviewed and green; the product is
  branded **Jiyan Items** (Q131). The last passes were 8a (data and performance, Q95 onward) and 8b (security,
  operations and maintainability, Q120–Q133). The build history is in `docs/CHANGELOG.md`.
- **The maintainer's one page** is "Maintainer quick start" in `README.md` (run, test, deploy, restore, recover,
  traps, yearly checklist). Keep it true when a command or a runbook changes.
- **Open, needing people rather than code:** the E6 screenshot baselines (rendered by CI, then committed; after
  that `playwright.live.config.ts` must fail on a missing baseline), native-speaker proofreading of ckb/ar, the
  manual receipt print check in four browsers, the owner's list tie-break and flow refresh-order questions (Q91,
  Q92), and the one-time server, GitHub and B2 steps listed in the runbooks (`deploy.md`, `backup-keys.md`).
- New work: a new iteration in `docs/iterations.md`, a new `Q` item in §2 for every decision, `docs/CHANGELOG.md`
  one entry per iteration.

## Layout

```
apps/api          NestJS 11 API (CommonJS). prisma/ = schema, migrations, sql/. src/scripts/ = migrate, healthcheck, reconcile, recover-admin, e2e-reset, seed-demo
apps/web          React 19 + Vite 8 + TanStack Router (file routes in src/routes). public/boot-prefs.js applies prefs before paint
packages/shared   ESM package built to dist/ (tsc -b): enums, permissions, error codes, dates, ledger math, zod schemas
deploy/           Caddy (+ Dockerfile building the web app), postgres/init roles script, backup/restore, deploy.sh
docs/runbooks/    Operational runbooks
```

## Commands

pnpm comes from corepack (`corepack enable --install-directory ~/.local/bin` was run once; `~/.local/bin` is on PATH — the default `/usr/local/bin` needs sudo). Docker runs through colima. Local ports: Postgres 5434, API 3000, Vite 5175 (ARCHITECTURE.md Q33).

| Command                                                                        | Purpose                                                        |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `pnpm install`                                                                 | Install (runs `prisma generate` for the API)                   |
| `pnpm db:up` / `pnpm db:down`                                                  | Dev Postgres on 127.0.0.1:5434 (also creates `pallet_test`)    |
| `pnpm db:migrate`                                                              | `migrate dev` + grants (development only)                      |
| `pnpm db:deploy`                                                               | `migrate deploy` + grants (CI / non-interactive)               |
| `pnpm --filter @pallet/api build && pnpm db:seed`                              | First admin + default settings                                 |
| `pnpm db:seed:demo` (after the build, API stopped)                             | Two months, ~10 of each, via the services (empty DB only)      |
| `pnpm dev`                                                                     | Shared watch + API (:3000) + web (:5175, proxies `/api`)       |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm format`    | Quality gates (all must pass)                                  |
| `pnpm test:integration`                                                        | API integration tests against real Postgres (+ coverage gate)  |
| `pnpm db:check-drift` (needs `SHADOW_DATABASE_URL`, an empty database)         | Fails when `schema.prisma` and the migrations disagree (Q85)   |
| `pnpm test:e2e`                                                                | Playwright (Chromium), mocked API                              |
| `pnpm test:e2e:live` (after `pnpm build`)                                      | E1–E8 against the built API on `pallet_test` (reset + seeded)  |
| `pnpm --filter @pallet/api recover-admin <username> [--promote]` (after build) | Temporary password from stdin when no admin can sign in (Q130) |

Local `.env` lives at the **repository root** (copy the LOCAL DEVELOPMENT block of `.env.example`).

## Rules that are easy to break

- **Pinned majors — do not bump without re-checking:** NestJS **11** (`@nestjs/throttler` and `@sentry/nestjs` peer only ≤ 11), TypeScript **6.0** (typescript-eslint supports < 6.1), Prisma **7.10** (8 was RC). Dependabot PRs for these majors must not be merged blindly. Exact versions everywhere (`save-exact`).
- **Money** is whole IQD: `bigint` in PostgreSQL, safe-integer `number` in TypeScript (convert only via `toSafeMoney` / `toDbMoney`). Every raw SQL `SUM()` of money is cast `::bigint`.
- **Ledgers are append-only:** `stock_movements`, `ledger_entries`, `audit_logs`, `return_lines` are never updated or deleted (DB grants + triggers enforce it); corrections are reversing rows. `returns` may only have its reversal columns set once. `items.quantity_on_hand` changes only together with stock movements.
- **Maintained order totals** (`orders.status/owed/held/...`, `order_lines.out_quantity/...`) are written only by `recomputeOrder()` using `packages/shared` ledger math — never incrementally. The one exception is what the table's CHECKs force to be written with the row, before the recompute: a new or rewritten line's `out_quantity = quantity` (`lineCacheSeed`) and a cancel's `status = 'CANCELLED'` (`cancelledMark`), both in `order-state.ts` and both the values the recompute then writes itself. `pnpm --filter @pallet/api reconcile` (after a build) must report 0 discrepancies.
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
