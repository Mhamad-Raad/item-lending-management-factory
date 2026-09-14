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
- **M1–M6 built; next: Milestone M7** (security hardening, deployment, backups, e2e). Work in the iterations of `docs/iterations.md`; each milestone must end runnable with its §15 acceptance checklist green.
- **1a done** (2026-09-12): `Clock`, `RequestContext` + middleware, `AuditService.record` with `toAuditSnapshot` / `redactAuditSnapshot`, the permission-declaration startup check, the bundled common-password list, the §7.10 i18n key rename, and the integration harness (`test/global-setup.ts`, `test/helpers/`) with the first integration test.
- **1b done** (2026-09-12): password service + policy (bundled list), login throttle with (ip, username) backoff, session families with rotation / 30 s grace / reuse detection, the five global guards in their fixed order, `/api/auth/login|refresh|logout|logout-all|me|change-password`, and the S-1 … S-9, S-16 … S-18, S-20, S-21 integration tests.
- **1c done** (2026-09-12): `/api/users` (list, create, get, patch, permissions, reset-password, logout-all) with the self, last-admin and version guards, `GET /api/audit-logs` with per-viewer cost redaction, `lockUser` / `lockActiveAdmins`, and the S-10, S-11, S-13 … S-16 integration tests.
- **1d done** (2026-09-12): web auth shell — `api-client` (refresh-once-and-retry, Web Locks cross-tab serialisation), in-memory auth store, route guards, `/login`, `/change-password`, the permission-filtered `_app` shell, `/users*`, `/account`, `/history`, the UI primitives those pages need, and the full ckb/ar/en key set (301 keys) with a completeness test over every error code, validation code, enum value and permission key.
- **M1 acceptance walked end to end** on the dev stack: first admin signs in → every other route answers `PASSWORD_CHANGE_REQUIRED` → password changed → employee created → permissions granted and revoked → all six actions appear in `/history`.
- **M1 reviewed end to end** (`9e70b91`): body limits, `MaintenanceService`, the login/reset race, cache clearing on sign-out and the missing §7.3.19/§7.3.21 controls were fixed.
- **2a done** (`9d98578`): uploads (Q35 pipeline, per-user `UploadThrottleGuard`, public serving) and factory settings (Q36 no-op save), web `apiUpload`, `ImageUploadField`, `/settings`.
- **2b done**: `StockLedger.apply` (the only writer of `quantity_on_hand`), `lockItems` / `lockBatch`, items (CRUD-as-archive, initial batch, stock adjustments, ledger listing with `balanceAfter`, derived `quantityOut` / `damagedTotal`) and purchase batches (soft delete, cost stripping); Q37 makes an unchanged item or batch PATCH a no-op. API only — the pages come in 2d.
- **2c done**: shared `normalizePhone` / `Phone` (Q13), customers (§4.5 totals in one SQL, holdings, duplicate-phone warning with `confirmDuplicatePhone`, phone check, archive refused with open orders) and drivers (archivable any time); Q37 covers them too. The customer history endpoint comes with M4. S-12 runs over `PermissionDeclarationCheck.scan()` and a copy of the §6.26 table — add every new route to `ROUTE_ACCESS` in `permission-catalogue.test.ts`.
- **2d done**: catalogue web — `DataTable`, `MoneyInput`/`QuantityInput`, `DatePicker`/`DateRangePicker`, `EntityCombobox`, `/items*`, `/customers*` (profile tabs wait for M3/M4), `/drivers`, `/history` date range + admin user filter; `docs/rtl-audit.md` (§7.11.1 checklist). **M2 done and reviewed as a whole**: the milestone review added §6.6's `runInTransaction` (`prisma/transaction.ts`, never built since M1; every mutation now uses it), Q37 for users PATCH, the unsaved-changes guard on `/settings` and `/users/new`, the shared `SEARCH_MAX_LENGTH`, LTR phone/car numbers, batch links in the stock ledger and the `createdAt` sort on every catalogue list. Still open: §7.8.3 route loaders (none exist since M1). M3 in progress.
- **3a done**: order engine — `POST/GET /api/orders`, `GET /api/orders/:id`; `lockOrder`/`lockOrderCounter`; `MoneyLedger` (only writer of `ledger_entries`); `recomputeOrder` + `toOrderState` (shared with reconcile); `IdempotencyService` (key row is the transaction's last statement; a known key is answered before any other check); credit rule with admin override; Q38 (a repeated item is a field error, `ORDER_DUPLICATE_ITEM` retired).
- **3b done**: `PATCH /api/orders/:id` (line diff, credit re-check, CASH payment re-issue), `POST /api/orders/:id/cancel`, `GET /api/orders/:id/receipt`, `GET /api/ledger-entries`; Q37 covers orders; Q39 (migration `20260912000000_cancelled_order_lines`: a cancelled order's lines may be zeroed); Q40 (`ORDER_LINE_HAS_RETURNS`). Integration tests stand in for M4's returns and payments with `test/helpers/ledger-fixtures.ts`; `createTestApp` listens once (supertest flake).
- **3c done**: orders web — `/orders` (status tabs, filters), `/orders/new` (daily flow 1: live totals, credit check, admin override, idempotency key via `useIdempotencyKey`), `/orders/$orderId`, `/orders/$orderId/edit`, `/print/orders/$orderId` (Sorani receipt, §7.16 CSS inlined by the route only). Web component tests run under jsdom per file (`// @vitest-environment jsdom`). **Open for M3 acceptance:** the manual receipt print check in Chrome, Firefox, Edge and Safari (needs the maintainer), and the receipt screenshot baseline (generated on the CI runner image).
- **M3 reviewed as a whole**: reconciliation now runs all of §4.9 R1–R7 (and reports a broken order instead of crashing); a same-key submit re-checks its key under the first lock (`IdempotentSession.replayIfStored`); the customer profile has its orders, payments and refunds tabs and a New order action; web e2e specs import `test` from `apps/web/e2e/fixtures.ts`, which seals unmocked API calls.
- **Post-M3 audit done** (3d–3f): §7.5 `AppShell` (lg sidebar; top bar with page title, navigation `Sheet`, user menu, skip link), 40 px targets below md at the primitives, `ListFilters` (filters in a bottom sheet on phones), customer summary two per row, §7.12/§7.13 tokens (`info`, `warning`, foregrounds; dark palette on screen only; `color-scheme`; line height 1.5 / 1.7 through Tailwind's `--text-*--line-height`), history links to orders, §7.8.3 loaders through `lib/prefetch.ts` (no retries; `defaultPendingComponent`), `/users` on `DataTable`, history cards on phones. `e2e/responsive.spec.ts` visits every route at 390 px with `e2e/mock-api.ts` (DTO-typed, long data): no horizontal scroll, touch targets, menu reachability — add new routes to it. Integration tests reconcile after every test (`test/reconcile-after-each.ts`); a file that writes around the services calls `skipReconciliation(reason)`. The app keeps its amber palette until the M6 theme pass.
- **4a done**: returns API — `POST /api/orders/:orderId/returns` (idempotent), `POST /api/returns/:id/replace`, `DELETE /api/returns/:id` in `modules/returns` (`validateReturnAgainstOrder`; an edit is priced against the order without the old return); Q41 (entries returning nothing are dropped, then `RETURN_EMPTY`). §11.3 is data in `packages/shared/src/audit-matrix.ts`: `AuditService.record` refuses a pair outside it and the locale test requires every summary — add new audit rows there.
- **4b done**: `POST /api/orders/:orderId/payments` (idempotent) and `POST /api/ledger-entries/:id/reverse` in `modules/ledger`; `GET /api/customers/:id/history` (`customer-history.ts`, one `UNION ALL`, then batched hydration). Tests record payments and returns through `recordPayment` / `recordReturn` (factories); `test/helpers/ledger-fixtures.ts` is only for the reconciliation test.
- **4c done**: `/returns/new`, `/payments/new` (daily flows 2 and 3), order-page actions on returns and payments, the customer history tab. **M4 reviewed as a whole** (`ed85d8c`): I14 (reconcile after a seeded 200-operation sequence), return rows by line, correction header, reference links.
- **M5 done and reviewed** (`043b8e6`): the four reports and the dashboard (API + web, print layouts; activity prints landscape on every page; dashboard stale time 15 s).
- **M6 built** — 6a (`0297ec4`): `rtl-classes.test.ts`, typed text isolated (`<bdi>`, `lib/bidi.ts` `isolate()`), typed i18n keys, glossary locale tests, `e2e/rtl.spec.ts`, Q43. 6b (`d831831`): §7.12 palette + `styles/theme.test.ts` (Q44), motion (Dialog/Sheet exits via `AnimatePresence` + `forceMount`, `AnimatedOutlet`, Q45 CSS button press), focus rings, `e2e/a11y.spec.ts` (axe), `motion.spec.ts`, `keyboard.spec.ts`. **M6 review**: E7 (`e2e/preferences.spec.ts`), sonner `richColors`/`closeButton` in the tokens with translated labels (Q46), `TableHead` `scope="col"` by default, rem radii; a list replaced outright remounts its row presence (old rows no longer stack above the new page); leaving dialogs and sheets are inert (`InertWhileLeaving`), and form dialogs remounted per opening no longer reset on close. **Open for M6 acceptance:** the E6/§7.11.2 screenshot baselines (CI runner image) and native-speaker proofreading of ckb/ar (client).
- **Whole-system review** (2026-09-14, after M6): CI had been red since the baseline — `pnpm audit` (multer, and the Prisma CLI's mysql2/deepmerge-ts: patched through `overrides` in `pnpm-workspace.yaml`) and, lately, an e2e sweep over its 30 s timeout (a11y tests now one per page). Fixed: the API pipe labelled every wrong-type value `required` (zod 4 issues carry no input without `reportInput`); Q47 return edit/delete lock the customer; Q48 a change writes stock additions before removals; idempotency hashes the normalised path (`IdempotencyService.requestFor`); `deploy.sh` rolls back on any failure after switching versions; dialog close button 40 px. Built what the spec named but no slice had: U7 `enums.test.ts`, U8, `zod-issues.test.ts`, S7 storage ESLint rule, D9 Sentry (`src/instrument.ts`, 5xx from `ApiExceptionFilter`), §14.1 coverage gates (shared domain 100 %, API modules 85 % in `test:integration`). DRY: `SessionService.logoutEverywhere`, order `priceLine`/`depositTotalOf`, shared `orderStateWithoutReturn`, `fromAggregate`/`ITEM_REF_INCLUDE`, web `DateField`, `components/ui/panel.tsx` (Dialog/Sheet), order form fields, `orderRowLink`. Spec file references corrected (Q49).
- **UI refresh** (2026-09-15, Q50): `/settings` opens to everyone with appearance option cards (light/dark/system, seven colour themes, five typefaces, four text sizes, language; `components/settings/`), the factory details for admins only; `/account` keeps profile, password and sessions. Tokens derive from four palette knobs on `<html data-palette>` in `globals.css` (`theme.test.ts` checks every theme × mode); `data-font` swaps `--app-font`; print pages set `data-force-light`. Grouped sidebar with brand, top bar with theme toggle and language menu; lists in cards with `bg-table-header` and striped rows (`DataColumn.wrap` for names, `hideBelow` up to `2xl`); `StatCard` tones (`lib/tones.ts`); payment-type pills. `e2e/appearance.spec.ts`.
- Still open from M1: S-12 and S-14 are covered (2c, 2b); `/history` gains its date-range filter with the shared `DatePicker` in 2d.
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

| Command                                                                     | Purpose                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm install`                                                              | Install (runs `prisma generate` for the API)                  |
| `pnpm db:up` / `pnpm db:down`                                               | Dev Postgres on 127.0.0.1:5434 (also creates `pallet_test`)   |
| `pnpm db:migrate`                                                           | `migrate dev` + grants (development only)                     |
| `pnpm db:deploy`                                                            | `migrate deploy` + grants (CI / non-interactive)              |
| `pnpm --filter @pallet/api build && pnpm db:seed`                           | First admin + default settings                                |
| `pnpm db:seed:demo` (after the build, API stopped)                          | Two months, ~10 of each, via the services (empty DB only)     |
| `pnpm dev`                                                                  | Shared watch + API (:3000) + web (:5175, proxies `/api`)      |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm format` | Quality gates (all must pass)                                 |
| `pnpm test:integration`                                                     | API integration tests against real Postgres (+ coverage gate) |
| `pnpm test:e2e`                                                             | Playwright (Chromium)                                         |

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
