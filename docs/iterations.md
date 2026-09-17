# Iteration plan

How `ARCHITECTURE.md` §15 (M0 → M7) is cut into shippable iterations, and the ritual each one follows.
The spec stays normative: this file only says **in what order** and **in what size** we build it. If an
iteration turns out to need a decision the spec does not settle, add a `Q` item to §2 — never guess silently.

## The ritual (every iteration, no exceptions)

1. **Read** the `ARCHITECTURE.md` sections listed for the iteration before writing code.
2. **Branch** `feat/<id>-<slug>` off `main` (e.g. `feat/1b-auth-core`).
3. **Build** the slice. Every new endpoint ships complete on arrival: access decorator, zod schema from
   `@pallet/shared`, `ERROR_CODES` only (never prose), audit rows per §11.3, and `ckb`/`ar`/`en` keys.
4. **Gates** — all green, no exceptions, no `--no-verify`:
   `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm test:integration`
   plus `pnpm build`, and `pnpm --filter @pallet/api reconcile` → `0 differences` from iteration 3a onward.
5. **Memory update #1 — what happened.** Update `build-progress` (current position, what the slice added,
   anything deferred). Facts only.
6. **Review — mandatory, never skipped.** Run `/code-review high` on the iteration branch and wait for it,
   then read the diff yourself against the rules below. Both halves are required: the command is not
   optional because a manual read "already covered it", and a clean command result is not a substitute for
   reading the diff. An iteration with no review is not finished, however small or however green the gates
   are. Treat every finding as a candidate and verify it before acting.
7. **Fix** what the review found; re-run the gates.
8. **Memory update #2 — what we learned.** One `feedback` memory per real lesson (a mistake that could
   recur, a pattern we settled on, a trap in the spec). Skip if the review found nothing worth keeping —
   do not manufacture lessons.
9. **Acceptance**: tick the iteration's exit criteria; the milestone's §15 checklist must be fully ticked
   before the next milestone starts. Then commit.

### Git

- One iteration, one branch: `feat/<id>-<slug>` off `main`, merged only after the review and the gates.
- **Nothing is committed before the review passes.** Commit at step 9, not earlier.
- Commits are clean and self-contained: the working tree is green at every commit, no commented-out code,
  no stray debug output, no unrelated formatting churn, no generated or local files (`.env`, `dist/`).
  If a fix is unrelated to the slice, it gets its own commit with its own subject.
- Commit messages: a subject line in the imperative, ≤ 72 characters, no trailing period; a blank line;
  then a body that says **why**, wrapped at ~78 columns. Reference spec sections as `§5.9` and files by
  path. No emoji, no ticket noise.
- **Never credit a tool or an assistant in a commit or a pull request.** No `Co-Authored-By` for an agent,
  no "generated with" footer, no mention of Claude or any other tool. The maintainer is the author.
- Never rewrite published history; amend only commits that have not been pushed.
- Never bypass the pre-commit hook (`--no-verify`) — fix what it reports instead.

### Review rules

- **Architecture** — matches `ARCHITECTURE.md` exactly; no features beyond it; canonical files (schema,
  `constraints.sql`, `grants.sql`, `permissions.ts`, `error-codes.ts`, `enums.ts`, `ledger-math.ts`) and the
  document changed in the same commit.
- **Patterns** — same shape as the code already in the repo (module layout, naming, error handling, query
  keys, route files). A new way of doing an old thing is a finding.
- **Correctness** — code bugs _and_ logic bugs: money as whole IQD via `toSafeMoney`/`toDbMoney`, append-only
  ledgers, totals only through `recomputeOrder()`, lock order customer → order → items → counter in one
  interactive transaction, `SELECT … FOR UPDATE` where the spec says so.
- **Tests** — the §14 cases for this slice exist and pass; new branches are covered; coverage gates hold
  (`domain/**` 100 %, listed API modules 85 %).
- **DRY / readable / maintainable** — no copy-paste of logic that belongs in a helper, no dead code, names
  that say what the thing is, functions small enough to hold in your head.
- **Lint / types** — zero warnings, no `any`, no `@ts-expect-error` without a reason comment.
- **Security & i18n** — no secrets in code or logs, no `dangerouslySetInnerHTML`, all three locale files in
  sync, logical CSS properties only (`ms-`/`pe-`/`start`/`end`).

---

## Iteration 0 — Baseline verification and dev environment

Prove M0 actually runs on this machine before building on it. Nothing new is written.

- Root `.env` from the LOCAL DEVELOPMENT block of `.env.example`; `pnpm install`.
- `pnpm db:up` → `pnpm db:migrate` → `pnpm --filter @pallet/api build` → `pnpm db:seed` → `pnpm dev`.
- Gates green; `GET localhost:3000/api/health` → 200; web shell renders RTL in `ckb`.

**Exit:** §15 M0 acceptance ticked; dev environment reproducible from `.env.example` alone.

---

## M1 — Auth, users, permissions, audit log

Read: §3, §6.4, §6.8, §6.11, §6.12, §6.26, §7.7, §10.1–10.3, §11, §14.4.

### 1a — Cross-cutting foundations

`Clock` (injectable, `FixedClock` in tests), `RequestContext`, `AuditService.record` + `toAuditSnapshot` +
write-time exclusions (§11.4), `PermissionDeclarationCheck` that fails startup on an undeclared route,
bundle `auth/common-passwords.txt` into the build output, rename scaffold i18n keys to §7.10 conventions.
Also the integration harness (§14.1): `test/helpers/`, and the `globalSetup` in
`vitest.integration.config.mts` that runs `migrate deploy` + `grants.sql` against **`pallet_test`** — CI's
`pnpm db:deploy` migrates `pallet` only, so without it the first integration test runs against an
unmigrated database.
**Exit:** startup check fails a deliberately undecorated route in a test; audit snapshots redact per §11.4;
one integration test boots the app against `pallet_test` and passes in CI.

### 1b — Auth core (API)

Password service (Argon2id, dummy hash, common-password list), login-throttle service, session service
(families, rotation, grace window, reuse detection), guard chain
`AppThrottlerGuard → CsrfGuard → AuthGuard → PasswordChangeGuard → PermissionGuard`,
endpoints `/api/auth/login|refresh|logout|logout-all|me|change-password`.
**Exit:** integration S-1 … S-18 (auth subset), S-20, S-21 green.

### 1c — Users and audit log (API)

`/api/users` list/create/get/patch/permissions/reset-password/logout-all with self-edit and last-admin
guards; `GET /api/audit-logs` with read-time redaction per viewer (§11.5).
**Exit:** permission change is effective on the _next_ request; every action from 1b/1c writes its §11.3 row.

### 1d — Web auth shell

`api-client.ts` + `refresh-lock.ts` (in-memory access token, `X-Requested-With`, refresh-once-and-retry,
Web Locks + BroadcastChannel), `/login`, `/change-password`, authenticated `_app` shell with
permission-filtered navigation, `/users`, `/users/new`, `/users/$userId` (permission checklist with
dependency auto-tick), `/account`, `/history`.
**Exit:** §15 M1 acceptance in full — U6, U10, U14, U15; first admin logs in, is forced to change password,
creates an employee, grants/revokes permissions, and every action appears on `/history`.

---

## M2 — Catalogue, stock, parties

Read: §4.6, §4.7 (stock ledger), §5.2, §6.13–6.18, §7.3, §7.5, §12.5.

### 2a — Uploads and settings

`POST /api/uploads`, `GET /api/uploads/:fileName`, sharp pipeline, per-user rate limit;
`GET`/`PUT /api/settings` + logo; web `/settings`.

### 2b — Items, batches, stock ledger (API)

Shared `StockLedger.apply(tx, movements[], userId)` (§4.6: per-item net, non-negative check, one UPDATE per item);
items CRUD-as-archive with `initialBatch`, stock adjustments, stock-movement list, derived `quantityOut` /
`damagedTotal` / `isLowStock`; purchase batches CRUD with soft delete, `BATCH_*` movements, cost stripping.
**Exit:** employee without `items.viewCost` sees no cost anywhere, API or UI; reconcile → 0 for items.

### 2c — Customers and drivers (API)

Phone normalization, duplicate-warning flow, phone-check endpoint, archive rule; drivers.

### 2d — Catalogue web

Shared `DataTable` (search, sort, pagination, sticky header, card layout < 640 px), `ImagePicker`,
`MoneyInput`, `QuantityInput`, searchable selects; `/items*`, `/customers*` (zeros until M3/M4), `/drivers`.
**Exit:** §15 M2 acceptance — U9, U12, I6 (stock parts), I11, I15, I16, S-14, S-19.

---

## M3 — Orders, credit limit, receipt

Read: §4.1–4.4, §4.8 (order flow), §6.5–6.7, §6.19, §7.4, §7.16.

### 3a — Order engine

`locks.ts` (customer → order → items sorted by id → counter), `recomputeOrder(tx, orderId)`, idempotency
service, `POST /api/orders` (steps 1–7), `GET` list and detail, credit-limit check with admin override.
**Exit:** the creation row of every worked example (§4.10) passes as an integration test, with the credit rule and its admin override; reconcile → 0. (E7 and E9 continue with an edit and a cancel, which are 3b's.)

### 3b — Order mutations and receipt

`PATCH /api/orders/:id` (header + line edit with CASH re-issue), `POST /cancel`, `GET /receipt`,
`GET /api/ledger-entries` (automatic payments so far).
**Exit:** worked examples 7 and 9 end to end; I4 (cancel without activity), I5, I7, I8, I9, I10.

### 3c — Orders web

`/orders`, `/orders/new` (one screen, live totals, credit-limit dialog), `/orders/$orderId`,
`/orders/$orderId/edit`, `/print/orders/$orderId` (two stacked copies, cut line, 6 lines per half,
"sheet X of Y", total on last sheet, Sorani only, Western digits).
**Exit:** §15 M3 acceptance incl. the manual four-browser print check.

---

## M4 — Returns, money ledger, payments

Read: §4.3, §4.5, §4.7 (money ledger), §4.8 (return/payment flows), §4.9, §4.10, §6.20, §6.21, §7.4.

### 4a — Returns (API)

`POST /api/orders/:orderId/returns` (`owedBefore` from the locked order, `cashRefund`, `REFUND` row,
`RETURN_ACCEPTED` movements), `POST /api/returns/:id/replace`, `DELETE /api/returns/:id`.

### 4b — Payments, reversals, aggregates

`POST /api/orders/:orderId/payments`, `POST /api/ledger-entries/:id/reverse`; order edit/cancel gates now
consider non-reversed returns and manual payments; customer holdings, history timeline, orders/payments/
refunds lists.

### 4c — Money web + full reconciliation

`/returns/new` and `/payments/new` one-screen flows (live refund due / cash refund / owed-after), returns
and money sections on the order page, reverse/edit return dialogs, customer profile.
**Exit:** §15 M4 acceptance — U1 (all), U2, U3; I1 (all nine worked examples), I2, I3, I4 (with activity),
I12, I13, and I14: 200 scripted operations → 0 reconciliation differences.

---

## M5 — Reports and dashboard

Read: §12, §6.22, §6.23, §7.3.

### 5a — Report and dashboard APIs

`GET /api/reports/positions|purchases|activity|stock`, `GET /api/dashboard` (sections gated per permission).
**Exit:** totals match hand-computed fixtures; cancelled orders and reversed returns never appear in an
aggregate; purchases report 403 without `items.viewCost`.

### 5b — Reports and dashboard web

`/reports/*` with filters, totals, print CSS (A4, repeating table headers); `/` dashboard with count-up
summary cards, quick actions, recent activity, low-stock card.

---

## M6 — i18n, RTL, theme, motion

Read: §7.10–7.15, §14.5.

### 6a — Language pass

Complete and review `ckb`/`ar`/`en` (§14.5 green, native-speaker proofreading recorded by the client);
RTL audit of every generated shadcn component → `docs/rtl-audit.md`.

### 6b — Presentation pass

Light/dark theme, font-size steps, `prefers-reduced-motion` and the §7.14 motion rules, skeletons, empty
states, keyboard (Enter submits, Esc closes, focus trap), visible focus rings, WCAG AA contrast.
**Exit:** U16; axe via Playwright → 0 serious/critical on the three daily flows; every screen usable at 390 px.

---

## M7 — Hardening, deployment, e2e

Read: §10, §13, §14.6.

### 7a — Security pass

§10 checklist line by line, `pnpm audit` clean, Dependabot enabled (majors pinned per CLAUDE.md stay pinned).

**7a fixes from the 2026-09-17 whole-system audit** (branch `feat/7a-reconcile-batching`, Q60): `reconcile`
failed outright on a 120,000-order database; R2 now walks the orders in batches of 1,000 by id.
**Exit:** `reconcile` on the 120,000-order load database → 0 discrepancies; the integration suite green.
**7a security and operations fixes** (branch `feat/7a-security-pass`, Q61): `COOKIE_SECURE` refinement, log and
Sentry scrubbing, container ceilings, first-deploy guard, disk-aware health probe, no source maps in the Caddy
image, optional `ADMIN_*`, the incident-triage runbook, §8.2 drift. **Exit:** unit + integration green;
`docker compose config` valid with the new limits.
**7a performance** (branch `feat/7a-performance`, Q62): open-order totals and partial indexes, item totals from the
maintained line columns, recent-activity and stock-ledger indexes, pool of 20, no report focus refetch.
**Exit:** every rewritten query returns the same rows as before on the 120,000-order database (`EXCEPT` both
ways); reconcile 0; unit + integration green.
The audit's remaining items (pg pool size, open-order aggregates and partial indexes, report period cap,
container memory limits, `COOKIE_SECURE` refinement, log/Sentry scrubbing, first-deploy guard, disk-full
health, sourcemaps, §8.2 drift) are listed in CLAUDE.md and belong to 7a–7c as each is picked up.

### 7b — Production deployment — _blocked on choosing a host_

Provision the VPS (§10.7, §13.4), fill `/opt/pallet/.env` from §13.2, first deploy through `deploy.yml`,
backups + disk-alert cron, uptime monitor, Sentry DSN.
**Exit:** `curl -sI https://<APP_DOMAIN>` shows the exact §10.5 headers; only 22/80/443 reachable.

### 7c — End-to-end and restore

E1–E8 green in CI; first quarterly restore test onto a fresh VPS performed and recorded.

**7c end-to-end done** (branch `feat/7c-real-api-e2e`, Q63): the live suite (`pnpm test:e2e:live`) runs E1–E8 against the
built API and a reset, demo-seeded `pallet_test`; CI runs it and uploads the Linux E6 baselines to commit. **Exit:** E1–E5,
E7, E8 green twice in a row locally (E6 is Linux-only) and cold with `CI=1`; a deliberately broken `orders.cancel` check
fails E8; the E6 baselines rendered by CI committed and CI green. The restore drill stays with the
deployment (7b), which the maintainer hands over.

---

## Environments

Three environments, one env-var contract (§13.2) — dev and production differ in _values_, never in shape.
Adding a variable means: `.env.example`, `apps/api/src/config/env.ts` (zod), `docker-compose.yml`, §13.2,
in the same commit.

|                | Local development                                    | CI                                | Production                                               |
| -------------- | ---------------------------------------------------- | --------------------------------- | -------------------------------------------------------- |
| Set up in      | Iteration 0                                          | exists (M0)                       | 7b                                                       |
| Config         | `.env` at repo root, from `.env.example`             | workflow env + service container  | `/opt/pallet/.env`, mode 600                             |
| Database       | `docker-compose.dev.yml`, `pallet` + `pallet_test`   | `postgres:18.6` service container | compose `postgres`, volume `pallet_pgdata`               |
| Notable values | `COOKIE_SECURE=false`, `TRUST_PROXY_SUBNET=loopback` | as dev, against `pallet_test`     | `COOKIE_SECURE=true`, `TRUST_PROXY_SUBNET=172.28.0.0/24` |

Production secrets are generated with `openssl rand -hex 32`, stored only in the password manager (§13.6),
and never committed — the GitHub repository is public.

**Open decision (7b):** the hosting provider. Any Ubuntu 24.04 VPS with 2 vCPU / 4 GB / 40 GB satisfies
§13.1; nothing before 7b depends on the choice, so it does not block iterations 0 → 7a.
