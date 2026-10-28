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

## After M7 — changes asked for by the business

Not part of §15: each is a request from the factory after the build was finished, decided as a `Q` item.

### 9a — Returns on the receipt (Q134)

Read: §7.16, §6.9 (receipt DTOs), §4.8.4.

The receipt's lines table gains three columns after the quantity — accepted, damaged, with the customer —
from the order line's maintained totals (`ReceiptLineDto`), and the footer the day of printing
(`ReceiptDto.printedOn`). No second table (it does not fit a half), no money. The toolbar's Print reads the
order again first.
**Exit:** an integration test records two returns and deletes one, and the receipt follows; the receipt unit
test reads the cells and the print date; `e2e/receipt.spec.ts` shows the eight headings on rows that are still
7 mm high with the input maxima inside their columns (proven by narrowing a column), and the PDF is still two
pages; live E5 records a return with the tab open and finds it on the reprint.

### 9b — A driver from the order form (Q135)

Read: §6.18, §7.3.13, §7.4.1, Q13, A13.

`GET /api/drivers/phone-check`, `confirmDuplicatePhone` on driver create and update, `DRIVER_PHONE_DUPLICATE`;
`DriverDialog` with the live warning and the in-place confirmation; the new-driver button of the order forms.
**Exit:** integration tests for the refusal, the confirmation, the live check and an edit that only checks a
changed phone, with the route in `ROUTE_ACCESS`; `e2e/order-driver.spec.ts` — the created driver is chosen and
the order keeps its typing, the dialog's Enter does not submit the order (proven by removing the guard), the
existing driver can be taken, the warning can be backed out of or confirmed, no button without
`drivers.create`, and the drivers page warns too.

### 9c — Sign out after 15 idle minutes (Q136)

Read: §6.8.3, §6.8.5, §7.7.3, §10.1 S7/S11.

Web: `lib/idle.ts` (activity shared between tabs, a check every second, the warning for the last minute,
sign-out at the limit, no restore of a session left idle), `IdleWarning`, the login page's notice. API: a
refresh more than `SESSION_IDLE_MS` after the last ends the family as `IDLE` (migration
`20261005000000_session_idle_reason`).
**Exit:** S-8 and the idle integration test; `e2e/idle.spec.ts` with the clock moved — warning at 14 minutes,
sign-out at 15, typing keeps the session, another tab's work keeps this one, a browser reopened after the
limit starts signed out without a refresh, a half-typed form does not hold the sign-out back, a refresh due
at the same moment does not bring the session back — and on the real clock the warning answered by a press or
a key but not by pointer movement; the unit test of a refresh overtaken by a sign-out (proven by removing the
guard).

### 10a — Payment and refund receipts (Q137)

Read: §4.2, §4.3, §4.7.2, §4.8, §6.21, §7.3.6, §7.3.12, §7.4.2, §7.4.3, §7.16.

A receipt for each payment and each refund, with the order's balance as it stood when the money moved:
`GET /api/ledger-entries/:id/receipt`, the print route `/print/ledger/$entryId` (one A4 sheet, two copies),
a button on the success toast of a payment and of a return that paid cash back, and a printer icon on the
payment and refund rows of the order page and the customer profile. A payment keeps what was owed before it
(`ledger_entries.owed_before`, migration `20261012000000_payment_owed_before`); a payment recorded before has
its figure replayed when printed, or prints the amount alone where the replay cannot be trusted. A deleted
payment or a reversed refund prints with a stamp.
**Exit:** integration tests for the receipt of a manual, an automatic and a deleted payment and of a refund,
the refusal of a reversal row and the permission; the replay of an old payment against figures worked by hand
on a history laid out by the minute, and null where it cannot be trusted (proven by breaking the replay);
the money receipt unit test; `e2e/money-receipt.spec.ts` (one PDF page, rows and stamp inside the half at
the input maxima, the Sorani refusal) and the toast and row buttons in `payments.spec.ts`, `returns.spec.ts`
(proven by offering a button without a refund) and `order-actions.spec.ts`.

### 10b — Dependency advisories (no Q)

`proxy-addr` (critical, Express's trusted-proxy check) and `source-map-js` (high, build and test only) pinned by
override, `sharp` (high, uploads) raised to 0.35.5 — all patch releases. **Exit:** `pnpm audit --audit-level=high`
clean, every gate green.

### 10c — One sign-out on its way at a time (Q138)

Read: §6.8, Q80, Q136.

`tellServerSignedOut()` carries both the idle sign-out and the page load's retry of a missed one; a sign-in waits
for either. **Exit:** the unit tests of two restores at once (and one later) and of a sign-in behind a Q80 retry,
both failing on the previous code; `idle.spec` green against a `NODE_ENV=test` build, as CI makes it, where it
failed before.

### 10d — Payment dialog, "Transactions", Print all, printing in place (Q139, Q140)

Read: §6.21, §7.3.6, §7.4.3, §7.16.

After a payment is saved, a dialog of what was paid with Close and Print instead of the toast; the order's money
section is "Transactions"; "Print all" prints every payment and refund of the order on one paper, by date
(`GET /api/orders/:id/transactions-receipt`, `/print/transactions/$orderId`), six to a half like the hand-over
receipt, reversed ones listed but not counted. Every receipt prints in place, drawn into a blank frame of the page
with the page's own session, instead of opening a tab (Q140). **Exit:** integration tests of the rows, order, totals and sheets;
`e2e/transactions-receipt.spec.ts` (two PDF pages, every cell inside its half at the largest figure — proven by
switching off the small type for long amounts); the dialog's figures, focus, Print, Close and Escape, and the refresh after Back with it
open (proven against the form without it), in `payments.spec.ts` and the live E4; "Print all" in `order-actions.spec.ts`; `e2e/print-in-place.spec.ts` (the money and hand-over receipts print once in place,
their paper alone, no new page; a refusal said on the page; a second press while preparing prints once — proven by
breaking the code).

### 10e — A return never asks back more than is out, as it is typed (Q141)

Read: §7.4.2.

The return form checks each row against what is out on its line while it is typed, not only on Record return:
the error shows under Accepted, both counts are marked invalid, the row prices nothing in the summary, no
hand-over is offered and Record return is disabled while any row is over. **Exit:** `returns.spec.ts` "Q141" (the error and exact summary figures
as typed, accepted and damaged counted together, nothing sent; with two lines, the valid one prices but no hand-over
is shown) and the line-removed test (the over row prices nothing) — each proven failing with its part of the change
removed.

### 10f — Returns as a table on the order page (Q142)

Read: §7.3.6.

The order page's returns become a table like the pallets and Transactions: one row per return, its items listed line
by line across the item, accepted and damaged columns, cards below `lg`; "replaced by" scrolls to whichever row or
card is shown. **Exit:** `order-actions.spec.ts` — the columns, newest first, items and counts line by line, the
damage-refund column only when needed, and "replaced by" at desktop and phone widths (the phone one proven failing
when the scroll picks the hidden table row).

### 10g — Hand cursor, Active status, customer form sections (Q143, Q144, Q145)

Read: §7.3.10, §7.3.11, §7.13.

Every button, link and menu item shows the hand on hover (one base-layer rule); the customers, drivers and items lists'
status column says Active or Archived instead of being blank for every active row; the customer form is two
titled sections with icons. **Exit:** `order-actions.spec.ts` "Q143" (computed cursors, proven failing without the
rule), `customers.spec.ts` "Q144" and "Q145".

### 10h — The damage refund says it is money and what it does (Q146)

Read: §7.4.2.

The damage-refund box shows the currency inside it, and under it a live line splits the damaged pallets' deposit into
what goes back to the customer and what is kept for the damage. **Exit:** `returns.spec.ts` "Q146" (the unit, the
split as typed and as the box's description, matching the summary, replaced by the error over the maximum).

The same day, after its review: an amount over the maximum is refused as it is typed, like a count over what is out,
and the line says "refunded" (a refund first lowers what is owed).

### 10i — Filter names without "any", date boxes take only dates (Q147, Q148)

Read: §7.5.

The orders and users filters say the field's name, or "All …" for a no-filter choice, instead of "Any …"; every date box drops letters and other
characters as they are typed. **Exit:** `lib/date-input.test.ts` (sanitizeTypedDate), `history.spec.ts` "Q148"
(proven failing without the filter); the existing e2e suite for the filter labels.

### 10j — A page for each driver (Q149)

Read: §7.3.12, §7.3.13, §7.3.18.

`/drivers/$driverId`: the driver's phone, car number and date added, Edit through the drivers' dialog, and every
order they were given with a status choice (default all), the order columns without the driver; reached from the
drivers list, the order page's driver and a driver's history entry. The customer profile's orders tab and the
driver's orders are one component (`RelatedOrders`). **Exit:** `drivers.spec.ts` "Q149" (the row opens the page;
the orders asked for by driver and ALL, no driver column, the status choice; Edit sends the version it opened
with and the page shows the saved driver; an archived driver has the banner and no Edit; the order page's driver
and the history entry link here; a phone card's menu action stays on the list; selecting a phone number in a row stays on the list; Back to an order after an edit
shows the saved driver) — the ALL default, the order page's link, the card menu and the order refresh each
proven failing when broken;
`/drivers/4` added to the responsive, contrast and direction sweeps.

### 10k — Earlier pallets still out on the hand-over receipt (Q150)

Read: §6.19 (`GET /api/orders/:id/receipt`), §7.16.

Under this order's lines, in the same table, a heading row and the customer's earlier orders' lines still out
(earlier by order number; open orders; `out_quantity > 0`), shaded, each with its order's number and in the total
column what of it is still out. The last sheet's footer: this order's deposit, the earlier pallets' deposit, the two
added. Up to six rows print as before, two copies to a sheet; more give each copy an A4 page of its own, 27 rows to a
page (`layoutReceiptRows`), all of the factory's pages before the customer's. **Exit:** `ledger-math.test.ts` "receipt layout"; `order-changes.test.ts` "six lines in
halves, more a page per copy" and "earlier orders' pallets still out" (another customer's, a cancelled order's, a
returned line's and a later order's left out); `receipt.test.tsx` (the factory's pages first); `receipt.spec.ts` E5 and "Q150" (the half's
five-row footer proven failing at 20 mm); `e2e-live/e5-receipt.spec.ts`.

### 10l — The hand-over receipt in the design the business chose (Q151)

Read: §7.16.3.

Five designs with the same content went to the business; they chose design 5. The hand-over receipt takes its
look: a blue title box and table header, pale blue parties, the earlier pallets in amber, and a footer of the
details beside a totals box ending on the figure in blue. Nothing else changes: the content, the block heights,
the rows per half or page, and the money and transactions receipts. **Exit:** the existing receipt suite (unit,
`receipt.spec.ts` E5 and Q150 at the largest totals, `print-in-place.spec.ts`, the live E5) unchanged and green;
the fit check measuring the footer across at the largest totals and the header under a long factory name (each
proven failing when broken); the real receipt compared by eye with the sample, with and without earlier pallets.

### 10m — Running for years unattended (Q152–Q155)

Read: §10.7, §13.3, §13.6, §13.8, §13.9.

The maintainer asked whether five people a day for five years, with no updates, holds. A load test on 125,000
orders (more than twenty years at "thousands a year") said the application does: 15 users at the per-user limit
for ten minutes, 59,000 requests, every screen p95 under 125 ms, reports under 0.4 s, the API flat at about
470 MB, no server error, reconcile clean. What would not hold is the operation around it, so: a hung API restarts
itself through its healthcheck (Q152); a lost database connection, which crashed a sibling project, is proven
harmless here and kept so by a test (Q153); the host installs security and Docker updates and reboots at night
(Q154); a monthly prune that stops being run is reported, and a stale restic lock no longer blocks it (Q155).
**Exit:** `decide` unit-tested; the restart proven in a real container (frozen at 10:02:21, restarted at
10:04:31); `connection-loss.test.ts` green and failing with either adapter listener removed; shellcheck,
`bash -n` and every gate green. **By hand:** the one-line command of `deploy.md` "The server keeps itself
patched" on the live server, and the healthchecks.io check "pallet-prune" before the next prune.

### 10n — Returns from the customer (Q156)

Read: §4.8.4, §6.20, §7.4.2.

The business asked that recording a return start from the customer: choosing them shows every pallet they still
hold with the order it belongs to, the order openable, and the count that came back entered there with buttons.
`GET /api/customers/:customerId/returnable` lists the open orders with pallets out and their lines still out;
`POST /api/customers/:customerId/returns` records a return on each order named in one transaction — each exactly
an order's return, checked and priced against its own order — all or none, idempotent. The screen: a card per
order (number opening it in a new tab, date, payment type, owed, "All of this order back"), a row per line with
− / + and "All" for pallets accepted and a "Damaged" toggle, the summary adding up each order's return, a dialog
with each refund's receipt when cash goes out. The maintainer then asked for it in the sidebar, under Orders
(Q157). **Exit:** `customer-returns.test.ts` (the list; two orders priced
each on its own; nothing written when any order refuses, every line over named; another customer's (open or
cancelled) and a missing order not found, cancelled,
early date, foreign line, empty, duplicate order; idempotent replay); `customer-returns.spec.ts` (counting with the
buttons, the summary's figures, the body sent, the dialog's print, refused as typed, one order to its page, a
server refusal marking rows and re-reading; a count on a line a reload drops named and held until let go; a
date before a touched order refused as typed; the row's controls on one line — each proven failing when broken); the route in `responsive.spec.ts` and `a11y.spec.ts`; live E3 (`e2e-live/e3-return.spec.ts`) through the customer
flow against the real API; every gate green.

### 10o — Earlier pallets on the hand-over receipt by item (Q158)

Read: §6.19, §7.16, Q150, Q151.

The business asked that the receipt's earlier pallets read per item over all the earlier orders, and show only
what the customer still holds. One row per item and deposit price (a second price keeps its own row), no order
numbers; in the same table and design, the item spans the quantity, accepted and damaged columns. **Exit:**
`order-changes.test.ts` (combined over orders, a returned part left out, another price on its own row, first
appearance order, the totals); `receipt.test.tsx` and `receipt.spec.ts` Q150 (five cells, the span); the real
receipt compared by eye.

### 10p — The change-password page only for those who must (Q159)

Read: §6.8.6, §7.3.2, §7.3.21.

The business reported the app asking for a new password every time a phone's browser was reopened. The change
itself works; the page let anyone signed in stay on it, and a phone reopens on the last page or a shortcut made
there. It now sends a user who need not change their password to the dashboard. **Exit:**
`e2e/change-password.spec.ts` (held while the flag is set; sent on when not, failing without the redirect); the
phone flow reproduced against the dev API before and after (first sign-in asks once; reopening the page's address
lands on the dashboard).

### 10q — Returns by item, oldest order first (Q160)

Read: §7.4.2, Q156.

The business asked that an item out on several orders read once on the customer return screen, with its total,
and that a count typed there fill the oldest order first. The screen now lists one row per item; a count is placed
oldest first by the order's date (damaged pallets first, the refund with them), shown in a split line under the
item with each order's number; the save sends each order its share, so the server and every order's return,
refund and receipt are as before. **Exit:** `allocate.test.ts` (the business's example, damage and refund
placing, a refund spilling over, over-out left unplaced, grouping and oldest by date); `customer-returns.spec.ts`
"Q160" (proven failing newest first) and the Q156 tests on the new layout; live E3; every gate green.

### 10r — One receipt for a customer's return (Q161)

Read: Q137, Q156, Q160, §5, §6.20–§6.22, §7.16.6, §11.2, §11.3.

The business asked that a customer's return over several orders give one receipt, naming no order; the maintainer
chose that it be one entry in the history and on the dashboard too, printable again later, with each order's page
still printing its own part. A `customer_returns` row (append-only) is written per customer return over two orders
or more and its orders' returns point to it (one order stays that order's own); the ledger and every order are
unchanged. Its receipt sums its returns as recorded, under its own number, stamped when one of them is corrected
since; one `CUSTOMER_RETURN.RETURN_CREATE` history row replaces its per-order return and refund rows; one
`CUSTOMER_RETURN` dashboard event replaces their lines. **Exit:** `customer-returns.test.ts` (the visit and its
one history row, the receipt's sums, none without cash, not found, partial and whole stamps, one dashboard event);
`db-privileges.test.ts`; `money-receipt.test.tsx`; `customer-return-receipt.spec.ts` and
`customer-returns.spec.ts` — each proven failing when its rule is removed; live E3; reconcile 0; every gate green.

### 10s — The return calculation on phones, long item names and notes, the orders under the items (Q162–Q165)

Read: §7.4, §7.4.2, Q156, Q160.

The maintainer found, testing 10r on an iPad and a phone, that the return screen's calculation was not shown below
`lg` (only one figure in the bottom bar), that a long item name grew its row and pushed its controls out of line, and
that the line under each item naming its orders was not needed — one section under the items, the order numbers alone.
Both return screens now draw the summary's fixed figures in the page below `lg`, at the top of the form; an item's
name takes two lines at most wherever it shares a row or card with figures, and a tap shows it whole where a count is
typed against it; the orders the pallets come from are one list of numbers under the items; the order's note is
titled, and it and each return's note take two lines at most, whole in their edit forms (Q165). **Exit:**
`e2e/phone-summary-names.spec.ts` (the card on both screens at 390 and 820 px, fixed in height, not at 1280; a
200-character name within two lines and whole after a tap — each proven failing when undone); `customer-returns.spec.ts`
(the orders section, the placing on the body sent after a look — proven failing with the old line); every gate green.

### 10t — Every return prints, the returns list, and pallets owed to a customer (Q166–Q171)

Read: Q137, Q156, Q161, §5, §6.20, §6.21, §7.4.2, §7.16.

Asked by the business and the maintainer on 2026-10-26, on one branch: every return ends on its dialog with a receipt
— a return paying no cash back gets its own paper in the same design, and every return prints again from where it
is listed (Q166); a return's papers list its pallets (Q167) and what the customer still holds of each (Q169); the
Returns item opens a list of every return with Record return, filters and paging (Q168); a customer may return more
than they had out, the factory owes them the rest, gives it back by button or with their next order, and the papers
and pages say so (Q170); the customer page's tabs keep the scroll and show their paging (Q171); a give-back prints its own paper (Q172) and can be undone if recorded by mistake (Q173). **Exit:**
`pallet-credits.test.ts`, `customer-returns.test.ts`, `money-receipts.test.ts`; `customer-returns.spec.ts`,
`returns.spec.ts`, `order-actions.spec.ts`, `customer-return-receipt.spec.ts`, `sidebar.spec.ts`; every gate green.

### 10u — Edit a return from the returns list (Q174)

Read: Q156, Q160, Q161, Q170, §6.20.

Asked by the business on 2026-10-26: Edit on each standing row of the returns list opens the customer screen with
every pallet the customer owes and the return's counts typed in, everything editable; a return over several orders is
edited whole, and only that page changes — the order page's correction stays as it is. The cash changing hands is the
difference. **Exit:** `return-edit.test.ts`, `return-edit.spec.ts`; every gate green.

### 10v — A return recorded with an order (Q175)

Read: Q150, Q156, Q160, Q161, Q174, §6.20, §7.16.

Asked by the business on 2026-10-28: Record return on an order shows every pallet the customer owes, placed oldest
order first, and each part still lands on its own order; the order's hand-over receipt lists the other orders'
pallets that came back with it, and the other order's receipt says with which order and when, so nothing reads as
returned twice. Then, while testing, that order's own items outlined at the top of that screen (Q176). **Exit:**
`return-with-order.test.ts`, `return-with-order.spec.ts`; every gate green.

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
