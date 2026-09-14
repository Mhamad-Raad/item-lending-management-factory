# Pallet System — ARCHITECTURE.md

| | |
|---|---|
| Document | Build-ready architecture and specification |
| Date | 2026-09-11 (versions pinned as of this date) |
| Repository | `github.com/Mhamad-Raad/item-lending-management-factory` |
| Audience | A builder agent implementing the system without access to anyone; the single maintainer |
| Status | Normative. The baseline (section 15, "M0") is already in the repository. |

**How to read this document.** Sections 1–5 define *what* the system is (terms, decisions, permissions, business rules, database). Section 6 defines the HTTP API, section 7 the web app, section 8 the shared package, section 9 where every file lives. Sections 10–14 cover security, audit, reports, operations and tests. Section 15 is the order to build in; section 16 lists ideas that are explicitly **out of scope**.

**Normative language.** "must", "never", "always" are requirements. Every name written in `code` (table, column, enum value, route, permission key, error code, i18n key, file path) is exact and must be used verbatim. When two passages appear to conflict, the more specific one wins, in this order: section 4 (business rules) → section 5 (schema) → section 6 (API) → everything else. Anything still ambiguous is resolved by the defaults in section 2.

**Source-of-truth files already in the repository** (this document embeds or mirrors them; if they ever diverge, fix the document and the file together in the same commit):

| File | Contents |
|---|---|
| `apps/api/prisma/schema.prisma` | Every table, column, enum, index and foreign key |
| `apps/api/prisma/sql/constraints.sql` | CHECK constraints, partial indexes, append-only triggers (part of the initial migration) |
| `apps/api/prisma/sql/grants.sql` | Least-privilege grants for the application role |
| `packages/shared/src/permissions.ts` | Permission keys, admin-only keys, dependency table |
| `packages/shared/src/error-codes.ts` | Error codes, HTTP statuses, error body shape, validation codes |
| `packages/shared/src/enums.ts` | Enums shared by API and web |
| `packages/shared/src/domain/ledger-math.ts` | Section 4 formulas as code (unit-tested against every worked example) |

## Table of contents

1. Overview and glossary
2. Open questions and chosen defaults
3. Actors, roles and permissions
4. Domain model and business rules
5. Database schema
6. API specification
7. Frontend specification
8. Shared package contents
9. Folder structure
10. Security
11. Audit log design
12. Reports
13. Deployment and operations
14. Testing plan
15. Phased build order
16. Suggested future improvements

---


## 1. Overview and glossary

### 1.1 System summary

**Pallet System** is an internal web application for a single-location pallet factory in the Kurdistan Region of Iraq. The factory **lends** pallets (it never sells them in this system) to customer companies against a per-pallet **insurance deposit** in IQD. The system records:

- **Items** (pallet types) with their deposit price and on-hand stock, and **purchase batches** (stock bought at a cost, for reports only).
- **Customers** (companies, not users), each with an optional **credit limit**, and **drivers** (saved records attached to hand-overs).
- **Orders** (hand-overs of pallets to one customer), paid in cash at hand-over (`CASH`) or taken on credit (`LENT`).
- **Returns** of pallets (accepted back into stock, or damaged and written off with a manual partial refund).
- An append-only **money ledger** per order (payments, refunds and their reversals) and an append-only **stock ledger** per item.
- Hand-over **receipts** (Kurdish Sorani, A4, two identical copies), four **reports**, a **dashboard**, and an append-only **audit log**.

Scale: one location, 2–5 admins, 5–10 employees, thousands of orders per year, one VPS, one maintainer, all staff behind one office public IP. The system must run for years: integrity, auditability and recoverability take precedence over cleverness. UX simplicity and tasteful motion are explicit requirements (section 7).

Architecture in one paragraph: a pnpm monorepo with `apps/web` (Vite + React SPA), `apps/api` (NestJS REST API over PostgreSQL via Prisma) and `packages/shared` (zod schemas, enums, permission keys, error codes, pure business-rule functions used by both apps). In production, Docker Compose runs `caddy` (TLS, static web build, reverse proxy of `/api`), `api` and `postgres` on one Ubuntu VPS; the browser talks to a single origin.

### 1.2 Technology stack (pinned 2026-09-11; exact versions, `save-exact=true`)

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js LTS "Krypton" (Docker `node:24.21.0-bookworm-slim`) | 24.21.0 |
| Package manager | pnpm via corepack (`packageManager` field) | 10.34.5 |
| Language | TypeScript, `strict: true` (7.x not used: typescript-eslint 8.70 supports TS < 6.1) | 6.0.3 |
| Database | PostgreSQL (`postgres:18.6-alpine3.24`) | 18.6 |
| Reverse proxy / TLS | Caddy (`caddy:2.11.4-alpine`) | 2.11.4 |
| Host OS | Ubuntu LTS | 24.04 |
| Frontend framework | react, react-dom | 19.3.0 |
| Build tool | vite, @vitejs/plugin-react | 8.3.0, 6.1.1 |
| Routing | @tanstack/react-router, @tanstack/router-plugin | 1.170.35, 1.168.37 |
| Server state | @tanstack/react-query | 5.102.8 |
| Forms | react-hook-form, @hookform/resolvers | 7.87.0, 5.9.1 |
| Validation (both apps) | zod | 4.6.2 |
| Styling | tailwindcss, @tailwindcss/vite, tw-animate-css | 4.3.3, 4.3.3, 1.4.0 |
| Components | shadcn CLI, radix-ui, class-variance-authority, clsx, tailwind-merge, sonner, cmdk, react-day-picker | 4.21.0, 1.6.7, 0.7.1, 2.1.1, 3.6.0, 2.0.8, 1.1.1, 10.0.1 |
| Icons | lucide-react | 1.45.0 |
| i18n | i18next, react-i18next | 26.4.2, 17.0.13 |
| Motion | motion (Framer Motion) | 13.2.0 |
| Dates | date-fns, @date-fns/tz | 4.4.0, 1.5.0 |
| Fonts (self-hosted) | @fontsource-variable/noto-sans-arabic (Arabic script incl. Sorani), @fontsource-variable/inter (Latin, Western digits) | 5.3.0, 5.3.0 |
| Backend framework | @nestjs/common, core, platform-express, testing (12.x not used: @nestjs/throttler 6.5.0 and @sentry/nestjs peer only ≤ 11) | 11.2.3 |
| Auth | @nestjs/jwt, argon2, cookie-parser (no passport — Q34) | 11.0.2, 0.45.1, 1.4.7 |
| Rate limiting | @nestjs/throttler | 6.5.0 |
| ORM | prisma, @prisma/client, @prisma/adapter-pg, pg (8.x not used: still RC) | 7.10.0, 7.10.0, 7.10.0, 8.23.0 |
| Uploads | multer (bundled by platform-express), sharp | 2.x, 0.35.4 |
| Logging | nestjs-pino, pino, pino-http | 4.6.1, 10.3.1, 11.0.0 |
| Error tracking (API only, optional) | @sentry/nestjs (active only when `SENTRY_DSN` is set) | 10.74.0 |
| API dev watch | tsc-watch (API builds with plain `tsc`, not the Nest CLI) | 7.2.1 |
| Unit / integration tests | vitest, @vitest/coverage-v8, unplugin-swc + @swc/core (decorator metadata), supertest | 5.0.0, 5.0.0, 1.6.0 + 1.16.2, 7.2.2 |
| Web component tests | jsdom, @testing-library/react | 30.0.1, 16.3.3 |
| E2E | @playwright/test | 1.63.0 |
| Lint / format / hooks | eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, eslint-config-prettier, prettier, husky, lint-staged | 10.10.0, 10.0.1, 8.70.0, 7.1.1, 0.5.6, 17.12.0, 10.1.8, 3.9.6, 9.1.7, 17.5.1 |
| Backups | restic (Ubuntu 24.04 apt package) to an S3-compatible bucket | apt |

Prisma 7 specifics: `apps/api/prisma.config.ts` holds the migration datasource URL (`DATABASE_MIGRATE_URL`); the generator is `prisma-client` with `output = "../src/generated/prisma"`, `moduleFormat = "cjs"` (NestJS compiles to CommonJS) and `runtime = "nodejs"`; the runtime client is `new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) })`. The generated folder is git-ignored and produced by `prisma generate` (run by the API `postinstall` and `build` scripts).

Module formats: `packages/shared` is ESM (`"type": "module"`, built with `tsc -b` to `dist/` with `.d.ts`); `apps/api` is CommonJS (`module: nodenext`) and loads the shared package through Node 24's `require(esm)`; `apps/web` is ESM bundled by Vite.

### 1.3 Glossary

| Term | Definition |
|---|---|
| Item | A pallet **type** (`items` row): name, optional image, `depositPrice`, `quantityOnHand`, optional `minStock`. Not an individual pallet; there are no serial numbers. |
| Deposit (insurance) | The IQD amount charged per pallet when it is handed over; called "price" by the client. Stored per item as `depositPrice` and copied per order line as `unitDeposit`. |
| Batch (purchase batch) | One purchase of stock for one item (`purchase_batches` row): `date`, `quantity`, `unitCost`, `totalCost = quantity × unitCost`. Increases `quantityOnHand`. Cost is for reports only and is never averaged. |
| Order (hand-over) | One hand-over of pallets to one customer with one driver on one business date (`orders` row), `paymentType` `CASH` or `LENT`, with one or more lines. Identified to humans by `orderNumber`. |
| Line (order line) | One item on an order (`order_lines` row): `quantity`, `unitDeposit` (frozen at creation), `lineTotal = quantity × unitDeposit`. An item appears at most once per order. |
| Return | One return event against one order (`returns` row) on a business date, with one entry (`return_lines` row) per order line being returned: `acceptedQuantity`, `damagedQuantity`, `damagedRefund`. |
| Reversed return | A return with `reversedAt` set (by an edit or a delete). It is excluded from every formula in section 4 and from every "has returns" gate. It is never updated again and never deleted. |
| Accepted | Pallets returned in usable condition. They go back to `quantityOnHand` (`RETURN_ACCEPTED`) and their full `unitDeposit` counts toward `refundDue`. |
| Damaged | Pallets returned damaged. They do **not** go back to stock (written off). Only the manually entered `damagedRefund` (0 ≤ damagedRefund ≤ damagedQuantity × unitDeposit) counts toward `refundDue`. |
| Payment | Money from customer to factory on one order (`ledger_entries.type = PAYMENT`): the automatic hand-over payment of a `CASH` order, or a manual payment on a `LENT` order. |
| Refund | Money from factory to customer on one order (`type = REFUND`), created automatically by a return when `cashRefund > 0`. |
| Reversal | An append-only ledger row (`PAYMENT_REVERSAL` or `REFUND_REVERSAL`) that cancels exactly one earlier `PAYMENT` or `REFUND` row of the same amount on the same order (`reversesEntryId`). Also used loosely for stock movements that undo earlier movements (`ORDER_CANCEL`, `RETURN_EDIT`, `RETURN_DELETE`, `BATCH_DELETE`). |
| Owed | What the customer owes the factory on an order: `owed = depositTotal − payments − credits + refundsPaid` (section 4.2); always ≥ 0. |
| Held | Deposit the factory is holding for the customer on an order: `held = max(0, outValue − owed)`; what the factory would pay back if every pallet still out came back accepted. |
| Out value | Insurance value of pallets still out on an order: `outValue = Σ outQuantity × unitDeposit`. |
| Compensation | Damage compensation assessed on an order: `Σ (damagedQuantity × unitDeposit − damagedRefund)` over non-reversed returns. On `LENT` orders part of it may still be inside `owed`, so it is labelled "assessed", not "income". |
| Credit limit | Optional per-customer maximum total out value (`customers.creditLimit`, IQD). Empty (NULL) = no limit; `0` = the customer may not take anything with a positive deposit. Checked by the rule in section 4.4. |
| Order status | Derived, never set by hand: `CANCELLED` if `cancelledAt` is set; else `OPEN` if any line has `outQuantity > 0` or `owed > 0`; else `SETTLED`. |
| Stock movement | An append-only row in `stock_movements` (item, signed quantity, reason, reference to the causing batch/order/return, user, timestamp). `items.quantityOnHand` is the maintained running total of an item's movements. |
| Token family (session family) | One login session in one browser (`session_families` row) owning a chain of rotating refresh tokens (`refresh_tokens`). Reuse of an old token revokes the whole family. |
| Business date | A user-chosen Asia/Baghdad calendar day stored in a SQL `date` column (order date, return date, payment date, batch date). Reports group by business dates. |
| System timestamp | A `timestamptz` in UTC (`createdAt`, `updatedAt`, `reversedAt`, audit time). Displayed in Asia/Baghdad. |
| Maintained column | A stored derived value (`orders.owed`, `order_lines.out_quantity`, `items.quantity_on_hand`) written only by the code paths defined in section 4.6 and verified by the reconciliation check. |
| Archive (soft delete) | Deleting an item, customer or driver sets `archivedAt`; the row disappears from pickers and default lists but stays in history. Nothing referenced is ever hard-deleted. |
| Idempotency key | A client-generated key sent in the `Idempotency-Key` header on order, return and payment creation, so a retried request never creates a duplicate (section 6). |

## 2. Open questions and chosen defaults

Every item below is an ambiguity, contradiction or gap in the brief. The builder implements the **default chosen** exactly; the maintainer may revisit any of them with the client later.

### 2.1 Assumptions from the brief (A1–A17)

| # | Question | Default chosen |
|---|---|---|
| A1 | Can items, customers and drivers referenced by orders be hard-deleted? | No. Deletion archives (soft delete: `archivedAt`, `archivedByUserId`); archived rows disappear from pickers and default lists but remain in history. See Q18 for the exact rules. |
| A2 | How is stock corrected outside batches and orders? | Manual stock adjustment on an item: signed quantity ≠ 0 with a required note, written as a `MANUAL_ADJUSTMENT` stock movement, audited (`STOCK_ADJUST`), requires `items.adjustStock` (admins always). |
| A3 | What can change after an order is created? | `customer` and `paymentType` are immutable. `driver`, `date`, `notes` are editable with `orders.edit`. Lines are editable only while the order has no non-reversed returns and no non-reversed manual payments; a `CASH` order re-issues its automatic payment on line edit. Cancelling is allowed only under the same condition; it restores stock (`ORDER_CANCEL`), reverses the automatic `CASH` payment and keeps the order visible as `CANCELLED`. Editing a return = reverse then re-apply; deleting a return = it never happened (reversing rows). |
| A4 | Is the cash refund on a return editable? | No. It is computed by section 4.3; recording the return asserts the cash was handed over at that moment. The only manual money input on a return is `damagedRefund` per line. |
| A5 | Does a new item need a cost history? | Item creation accepts an optional initial purchase batch (`date`, `quantity`, `unitCost`, `note`); without it the item starts at quantity 0. The initial batch additionally requires `purchases.create`. |
| A6 | How are order numbers allocated? | Gap-free increasing integers from 1, allocated inside the creation transaction from the locked single-row `order_counter`; shown zero-padded to 6 digits (`000123`) on the receipt and in the UI; numbers above 999999 are shown unpadded. Cancelled orders keep their number. |
| A7 | Payment limits and scope? | A payment on a `LENT` order cannot exceed the order's current `owed`. Payments are per order; there is no customer-level payment. Manual payments on `CASH` orders are rejected (`PAYMENT_ORDER_NOT_LENT`). |
| A8 | Cardinalities? | One customer per order; one driver per order; an item appears at most once per order (`VALIDATION_FAILED` `duplicate`, Q38; DB unique `(order_id, item_id)`). |
| A9 | Receipt content? | Only the fields listed in section 7 (receipt print route); no notes, no signature lines. |
| A10 | Report export? | On screen and printable only; CSV/Excel export is out of scope (section 16). |
| A11 | Password policy and recovery? | Minimum 10, maximum 128 characters; rejected if in the bundled common-password list or equal to the username; admins reset passwords; no email or self-service reset. |
| A12 | Low-stock flag without `minStock`? | `minStock` is optional; items without it are never flagged. `isLowStock = minStock IS NOT NULL AND quantityOnHand ≤ minStock`. Archived items are never flagged on the dashboard. |
| A13 | Duplicate customer phones? | Warning with confirmation, not a hard block (`CUSTOMER_PHONE_DUPLICATE` unless `confirmDuplicatePhone = true`). See Q13. |
| A14 | Can status be edited? | No. `status` is derived by section 4.2 and written only by `recomputeOrder()`. |
| A15 | Receipt overflow? | Lines are split into chunks of `RECEIPT_LINES_PER_HALF = 6`; each A4 sheet carries the same chunk twice; every chunk repeats the header and shows "sheet X of Y"; the deposit total is on the last sheet only. |
| A16 | How are ledger corrections made? | Always by reversing rows. Nothing in `stock_movements` or `ledger_entries`, and no `returns` row, is ever updated (except Q5) or physically deleted. Reversal rows are dated the day the correction is recorded. The automatic hand-over payment has no stored date; its date is the order's `date`. |
| A17 | Display timezone? | All dates and times are displayed in Asia/Baghdad (UTC+3, no DST) regardless of the browser's zone. |

### 2.2 Additional questions found while designing (Q1–Q32)

| # | Question | Default chosen |
|---|---|---|
| Q1 | The brief asks for the "current stable" NestJS; NestJS 12 exists but `@nestjs/throttler` 6.5.0 (mandated) and `@sentry/nestjs` declare peers only up to 11. | Pin NestJS **11.2.3**. Upgrade to 12 once both packages declare support (section 13, upgrade path). |
| Q2 | TypeScript 7 (native compiler) is the latest, but `typescript-eslint` 8.70 supports TypeScript < 6.1 only. | Pin TypeScript **6.0.3**. |
| Q3 | Prisma's npm `latest` tag points at 8.0.0-rc.13, a release candidate. | Pin the last stable **7.10.0** (`prisma`, `@prisma/client`, `@prisma/adapter-pg`). |
| Q4 | "The API never returns user-facing prose" conflicts with a "human-readable summary" in the audit log. | Audit rows store `summaryKey` (i18n key `audit.summary.<ENTITY_TYPE>.<ACTION>`) and `summaryParams` (names, quantities, order numbers; never cost values); the web app renders the sentence in the viewer's language. |
| Q5 | "Return rows are never updated" conflicts with setting `reversedAt` on the original. | The only permitted UPDATE on `returns` sets `reversed_at`, `reversed_by_user_id`, `reversal_kind`, `replaced_by_return_id` once, from NULL, in one statement. Enforced by a column-level `GRANT UPDATE (reversed_at, reversed_by_user_id, reversal_kind, replaced_by_return_id)` and the trigger `returns_reversal_set_once`. |
| Q6 | `reports.view` per report or for all? | Four per-report keys replace a single `reports.view`: `reports.viewPositions`, `reports.viewPurchases`, `reports.viewActivity`, `reports.viewStock`. `reports.viewPurchases` depends on `items.viewCost`. |
| Q7 | Permissions have natural prerequisites (creating an order needs the customer picker). | Dependency table in section 3.3 (`PERMISSION_DEPENDENCIES`). The UI auto-ticks dependencies and unticks dependents; the API rejects an unclosed set with `PERMISSION_DEPENDENCY_MISSING` (`details.missing = [keys]`). |
| Q8 | Can business dates be in the future? | No. Dates after today (Asia/Baghdad) are rejected with `BUSINESS_DATE_IN_FUTURE`; the earliest accepted date is 2000-01-01. |
| Q9 | Can a return or payment be dated before its order? | No: `RETURN_DATE_BEFORE_ORDER_DATE`, `PAYMENT_DATE_BEFORE_ORDER_DATE`. Moving an order's date after its earliest non-reversed return date or earliest non-reversed manual payment date is rejected with `ORDER_DATE_AFTER_ACTIVITY`. |
| Q10 | Can a cancelled order's receipt be printed? | No. The receipt endpoint returns 409 `ORDER_CANCELLED` and the print button is hidden. |
| Q11 | Activity report filters on money (money is per order, not per item). | `customerId` and `driverId` filter by the order (returns and money rows of matching orders are included). `itemId` filters hand-over lines and return lines; when `itemId` is set, the payment and refund sections are omitted and the response carries `moneyOmitted: true`; compensation is per return line and stays. |
| Q12 | Which permissions gate the dashboard? | Positions cards (pallets out, total owed, total held) need `reports.viewPositions`; the low-stock card needs `items.view`; recent activity needs `orders.view`. Sections the user may not see are absent from the response and hidden in the UI; the dashboard endpoint itself needs only authentication. |
| Q13 | How are phone numbers compared? | Normalise by reading Arabic-Indic digits as Western ones and removing spaces, dashes and parentheses (`normalizePhone`, §8.7); the result must match `^\+?[0-9]{7,15}$` and is stored normalised. Duplicate detection = exact equality of the normalised value against `phone` and `altPhone` of every other customer, archived ones included. The same normalisation and format apply to `drivers.phone` (no duplicate warning for drivers). |
| Q14 | Receipt lines per half page? | `RECEIPT_LINES_PER_HALF = 6` at the fixed receipt font size (section 7 (receipt print route)). |
| Q15 | `unitDeposit` when lines are edited? | Existing lines keep their stored `unitDeposit` unless the request supplies one; new lines get the item's current `depositPrice` unless supplied. Supplying `unitDeposit` requires `orders.editUnitDeposit` (admins always), otherwise `UNIT_DEPOSIT_NOT_PERMITTED`. |
| Q16 | What exactly does an idempotent replay return? | The stored response status and body verbatim, with header `Idempotency-Replayed: true`. |
| Q17 | May a user without `items.viewCost` enter batch costs? | Yes (write without read): `purchases.create`/`purchases.edit` accept `unitCost`; every response strips cost fields for that user. |
| Q18 | Archive rules. | `DELETE` on items/customers/drivers always archives (never hard delete); unarchive is a future improvement. Archiving a customer with any `OPEN` order is rejected (`CUSTOMER_HAS_OPEN_ORDERS`). Items and drivers can be archived any time. New orders and line additions reject archived customers/drivers/items (`CUSTOMER_ARCHIVED`, `DRIVER_ARCHIVED`, `ITEM_ARCHIVED`); returns, payments and header edits on existing orders keep working. |
| Q19 | Username rules. | Lowercase `^[a-z0-9._-]{3,32}$`, unique, immutable after creation. Login lowercases the submitted username before lookup. |
| Q20 | Stock non-negativity inside multi-movement operations (return edit writes −old then +new). | The check runs on each item's **net** change of the whole operation against the locked on-hand value; movement rows are still written individually; each item gets one `UPDATE items SET quantity_on_hand = quantity_on_hand + net WHERE id = :itemId`. `CHECK (quantity_on_hand >= 0)` is the backstop. Failure → `STOCK_INSUFFICIENT` with `details.items = [{ itemId, requested, available }]`. |
| Q21 | `CASH` order with `depositTotal = 0`? | No automatic payment row (ledger amounts must be > 0); `owed = 0`. |
| Q22 | Who writes the Sorani and Arabic texts? | The builder writes complete `ckb` and `ar` translation files and the Sorani receipt labels (section 7 (receipt print route) gives the receipt labels); a native speaker at the client proofreads them before go-live (acceptance checklist). |
| Q23 | Are item names unique? | No. |
| Q24 | Which payments block line edits and cancellation? | Only non-reversed **manual** payments (`source = MANUAL`); the automatic hand-over payment never blocks. Non-reversed returns block. |
| Q25 | Stored or computed derived values? | Order and line derived values are maintained columns written only by `recomputeOrder(tx, orderId)` (full recompute from source rows with `computeOrderTotals`, never incremental). `items.quantity_on_hand` is maintained by stock movements. Customer and item aggregates are computed on read with SQL. A reconciliation command verifies all maintained values (section 4.8). |
| Q26 | Development environment shape. | `docker-compose.dev.yml` runs only PostgreSQL on `127.0.0.1:5434` (Q33); API and web run on the host with hot reload; the Vite dev server (port 5175, Q33) proxies `/api` to `http://localhost:3000`, so development is also same-origin. CORS is enabled only when `NODE_ENV=development` and `CORS_DEV_ORIGIN` is set. |
| Q27 | Behaviour while `mustChangePassword` is set. | Every endpoint except `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/logout`, `POST /api/auth/logout-all` and `POST /api/auth/refresh` returns 403 `PASSWORD_CHANGE_REQUIRED`; the web app redirects to `/change-password`. |
| Q28 | Are replaced uploads deleted? | No. Replacing an image creates a new upload; old files stay (history; negligible size). |
| Q29 | What does archiving a customer affect? | It hides the customer from pickers and default lists only; existing orders keep referencing it and remain fully operable. |
| Q30 | Does editing stock or derived values bump `version`? | `items.version` changes only on edits of item fields (name, price, minStock, image), never on stock movements. `orders.version` increments on every operation that touches the order after creation (edit, cancel, return create/edit/delete, payment create/reverse), so a stale order page always gets `VERSION_CONFLICT` on its next edit. |
| Q31 | Database session safety nets. | The runtime role has `statement_timeout = 30s` and `idle_in_transaction_session_timeout = 60s`; all roles use `timezone = UTC`. |
| Q32 | Extra integrity beyond the brief's CHECK list. | The database additionally enforces: stock movement sign per reason, reference-per-reason, ledger source-per-type, reversal rows mirroring their original (trigger `ledger_reversal_matches_original`), `cash_refund = GREATEST(0, refund_due − owed_before)` on returns, and append-only triggers on audit, stock and money tables (section 5.6–5.8). |
| Q33 | Which host ports does local development use? | PostgreSQL `127.0.0.1:5434` and the Vite dev server `5175` — the defaults 5432, 5433 and 5173 are commonly held by other projects on a maintainer's machine, and a busy port fails the whole `pnpm dev` run. Local database URLs use `127.0.0.1`, never `localhost`, because the container publishes on IPv4 only while `localhost` resolves to `::1` first on macOS. The ports appear in `docker-compose.dev.yml`, `apps/web/vite.config.ts`, the LOCAL DEVELOPMENT block of `.env.example`, `README.md` and the §9.1 repository tree — changing them means changing all five; CI and production reach PostgreSQL over the container network on 5432 and serve the web build through Caddy, both unchanged. |
| Q34 | Passport or a plain guard for the access token? | A plain `AuthGuard` using `JwtService`. The application has exactly one credential type and must load the user from the database on every request anyway (§10.1 S8), so `@nestjs/passport` + `passport-jwt` would add two dependencies and a strategy indirection around a three-line verification. The behaviour of §6.4.1 is unchanged; only the mechanism is simpler. |
| Q35 | The upload pipeline is described twice (§6.14 and §10.4 I5–I9) with three disagreements. | Settled as follows, and both sections now say the same thing. **Multer limits** `{ fileSize: 5 MiB, files: 1, fields: 0, parts: 2 }`: `kind` travels in the query string, so a request carrying form fields is malformed and is rejected rather than ignored. **Type detection** is both checks in order — the magic bytes first (cheap, and it rejects a renamed text file before any decoder touches it), then `sharp().metadata()`, whose `format` must also be one of `png`, `jpeg`, `webp`. **Output size** 1600 px for `ITEM_IMAGE` and 800 px for `FACTORY_LOGO` (the §10.4 values): an item photo is opened on a detail page, where 1024 px is visibly soft on a laptop screen. Multer's own refusals map to: `LIMIT_FILE_SIZE` → 413 `UPLOAD_TOO_LARGE`; a file under another field name → 400 `UPLOAD_MISSING_FILE`; any form field → 400 `VALIDATION_FAILED` (`unknown_key`); a second file or part → 400 `VALIDATION_FAILED` (`too_big` on `file`); a malformed multipart body → 400 `VALIDATION_FAILED` (`invalid_format` on `file`). |
| Q36 | What does saving an unchanged settings form do? | Nothing: the stored settings come back as they are, with no version bump and no `SETTINGS_CHANGE` row. A history entry saying nothing changed is noise, and an unchanged version keeps the form open in another tab valid. The version is still checked first, so a stale form is refused even when it would change nothing. |
| Q37 | What does a PATCH that changes nothing do on an item, a purchase batch, a customer, a driver, a user or an order? | The same as Q36: after the version check, the stored row comes back as it is — no version bump, no `UPDATE` row, no stock movement. A version bump with no history row would be an edit the history cannot explain, and it would needlessly make a form open in another tab stale. |
| Q38 | How is an item repeated in an order's lines reported? | By the shared schema, as `VALIDATION_FAILED` with the field error `duplicate` on the repeated line's `itemId` (§8.5): the API validates with the same schema before its own checks, so a separate `ORDER_DUPLICATE_ITEM` could never be reached, and the field error points the form at the line to fix. The code is retired from the catalogue. The database's unique `(order_id, item_id)` stays as the backstop. |
| Q39 | A cancelled order's lines show `outQuantity` 0 (§4.2), but the `order_lines` check required `out_quantity = quantity − returned_accepted − returned_damaged`. Which wins? | §4.2: nothing is out on a cancelled order, and the order page and every aggregate must say so. The check (migration `20260912000000_cancelled_order_lines`) now also accepts the zeroed state — `out_quantity`, `returned_accepted` and `returned_damaged` all 0 — which only a cancelled order's recompute produces. Reconciliation R2 still compares every line with `computeOrderTotals`, so a live line zeroed by mistake is still reported. |
| Q40 | May a line edit remove a line that a reversed return was recorded on? | No. The activity gate counts only returns that are not reversed, but `return_lines` are append-only and reference their order line, so the line cannot be deleted without losing that history. The edit is refused with `ORDER_LINE_HAS_RETURNS { itemId }`; the line may still be lowered (its quantity stays > 0). |
| Q41 | What happens to a return entry with nothing on it (0 accepted, 0 damaged)? | It is dropped, not refused: `ReturnCreateBody` filters out every entry with `acceptedQuantity + damagedQuantity = 0` and `damagedRefund = 0`, and a return left with no entries is refused with `RETURN_EMPTY` (§4.8.4 step 1, I13). An entry with a damaged refund but no damaged pallets is kept and refused with `DAMAGED_REFUND_TOO_HIGH`. §6.20 once described a `too_small` refine for such an entry; that would have answered `VALIDATION_FAILED` where §4.8.4 and I13 expect `RETURN_EMPTY`. |
| Q42 | §6.9, §6.23 and §12 describe the report responses and queries differently (`columns`/`palletsOutByItem` vs `items`/`perItem`, `includeZero` vs `includeSettled`, grouped hand-overs vs flat lines). Which is the contract? | §6.9's DTOs and §6.23's query schemas, which `packages/shared` mirrors and the §7.3.17 pages read. §12 remains the source for the SQL strategy and the common rules, of which two are carried into the DTOs: every report has `generatedAt`, and the period reports (purchases, activity) have `truncated` for the 5,000-row cap. Positions keeps customers with pallets out, owed or held unless `includeZero`; both snapshot reports accept `sort`. |
| Q43 | §7.10, §7.11 and §14.5 disagree with themselves or with the code in four places: the §7.11 enforcement regex, read literally, flags JavaScript identifiers such as `pr` and misses CSS such as `margin-left`; the language names are listed as `account.language.*` keys whose identical value in all three files fails rule 5; §7.10 and §14.5 give different Latin allowlists; and names typed in Latin script are only said to take `dir="auto"` "in table cells and headings". What holds? | `rtl-classes.test.ts` checks physical-side Tailwind utilities (with any variant or negative prefix), `left`/`right` given as a quoted value, and physical CSS properties, in code and class names but not in comments; a line may still keep one with `// rtl-ok: <reason>`. Language names are the constant `LANGUAGE_NATIVE_NAMES` (`lib/preferences.ts`), never translated, so no key needs the Latin allowlist and it is empty. Text people typed is isolated wherever it is shown: `<bdi>` around names, notes and labels in elements (table cells holding plain text are isolated by `DataTable`/`ReportTable`, titles by `PageHeader`), and the Unicode isolates U+2068/U+2069 (`lib/bidi.ts` `isolate`) around a name interpolated into a translated sentence. An isolated name sits inside an element that keeps the page's direction, so a short Latin name still lines up with the text around it; and `SearchQuery` drops the direction marks a name copied from the page carries. `useLogicalSide` is built with the first popover or menu that needs a left or right side; none does. The §7.11.2 screenshots wait for their baselines from the CI runner image, together with E6 and the receipt's; until then `e2e/rtl.spec.ts` asserts the direction, the mirrored icons, the isolation of every name on the pages and dialogs that show one, and their alignment. |
| Q44 | §7.12 states that every token pair meets WCAG AA, but two of its values do not: light `--warning-foreground` (`oklch(0.15 0.03 70)`) on `--warning` measures 3.5 : 1, and `--border` / `--input` (`oklch(0.87 0.01 250)` light, `oklch(0.34 0.015 250)` dark) measure 1.4–1.6 : 1 against the surfaces, short of the 3 : 1 a field's outline needs. Which gives way? | The contrast requirement. Light `--warning-foreground` is `oklch(0.99 0 0)` (5.5 : 1). `--input`, which outlines fields, checkboxes, radios and switches, is `oklch(0.6 0.02 250)` light and `oklch(0.55 0.02 250)` dark (3.7–4.0 : 1). `--border` keeps §7.12's value: it only divides rows and cards. The light soft success badge tints its background at 8 % rather than 12 %, where its text measured 4.4 : 1. `apps/web/src/styles/theme.test.ts` pins the palette to this table and recomputes every ratio; `docs/rtl-audit.md` records them. |
| Q45 | §7.14 presses buttons with `motion.button` `whileTap={{ scale: 0.98 }}`. motion's tap gesture also answers Enter by emulating a pointer press, and a Radix trigger (the user menu) toggled by both that and the key closes the menu it has just opened: Enter no longer opens it. How does a button press? | Through CSS on every button, as §7.14 already gives for `asChild`: `active:scale-[0.98]` with a 150 ms transition of colour and scale. `e2e/keyboard.spec.ts` opens the user menu with Enter and checks it stays open; `e2e/motion.spec.ts` checks the press. |
| Q46 | §7.11.1 gives sonner `richColors`, and §7.12 requires AA for every text, but sonner's rich palette measures 4.3 : 1 for success text in light; tinted like the dark soft badges (20 %), error text on a popover measures 4.3 : 1 too. Its region label is also English ("Notifications alt+T") in every language. What holds? | `richColors` and `closeButton` are on, with sonner's colour variables set from the tokens: background `color-mix(in oklch, var(--<token>) 12%, var(--popover))` in both themes, border 30 %, text `var(--<token>)` (error → `destructive`). The region is labelled `common.notifications` and the close button `common.actions.close`. `e2e/styles.spec.ts` measures a success and an error toast in both themes (≥ 4.5 : 1) in Kurdish. |
| Q47 | §4.4 calls the credit check exact because it sums the customer's out value under the customer's lock, but §4.8.5 and §4.8.6 lock only the order: deleting a return, or replacing it with a smaller one, puts pallets back out and raises that out value without the lock, so an order priced for the same customer at that moment misses it and can end over the limit with no override recorded. Do return changes lock the customer? | Yes. Edit and delete read the order's customer unlocked (it never changes) and take `lockCustomer` before `lockOrder`, in the global order of §6.6. Creating a return only lowers the out value and a payment never touches it, so they keep locking the order alone. `test/integration/return-locks.test.ts` holds the customer row and checks that both wait. |
| Q48 | The item history shows a running balance by movement id (§6.15), and `StockLedger.apply` judges only each item's net change. When one change writes a removal before an addition — a return edit writes the old return's −accepted before the new one's +accepted — and the returned pallets have gone out again, the history shows a negative balance on the first row although stock never went below zero. In what order are one change's rows written? | Additions first, then removals, each group in the caller's order. The running balance within one change then never dips below the lower of the stock before and after it, both of which the stock check keeps at zero or more. I2's movement order follows. |
| Q49 | A whole-system review (2026-09-14) found §8.9, §9 and §10 naming files the build placed differently: `packages/shared/src/i18n-keys.ts` and the schema files `index.ts`, `ledger.ts`, `dashboard.ts` never existed (the audit list query sat in `users.ts`, the ledger list query in `orders.ts`), the web app has no `tsconfig.node.json`, `src/test/setup.ts` or `features/auth`, and several §10 rows name guard and store files by other names. Which gives way? | The code where it is the better place, the document otherwise. `AuditLogListQuery` moved to `schemas/audit.ts` and `LedgerEntryListQuery` to `schemas/payments.ts` as §6.27 says. i18n key types stay in the web app, where the translation files live (§8.9 rewritten). The §9 trees and the §10 file references now name the files that exist; `e2e/auth.spec.ts`, `e2e/daily-flows.spec.ts` and `e2e/__screenshots__/` remain M7 deliverables. |
| Q50 | The maintainer asked for a redesigned interface (2026-09-15): colour themes, typefaces and text sizes chosen on the settings page, tinted table headers and striped rows, and figures with colour. §7.12 fixes one palette and one font stack, §7.3.20 makes `/settings` admin-only and §7.3.21 keeps the preferences on `/account`. What holds? | The preferences move to `/settings`, which every signed-in user opens: light / dark / **system** (follows `prefers-color-scheme`, also while open), seven colour themes (`PALETTES`: harbor, lagoon, forest, timber, clay, plum, graphite), five typefaces (`FONT_FAMILIES`: inter, vazirmatn, plex, kufi, naskh — each carries every Sorani letter and Western digits; self-hosted `@fontsource` packages), the four text sizes and the language, each an option card with a live preview. The factory details stay on the same page for admins only (`GET /api/settings` is fetched only for them; `PUT` stays `@AdminOnly`). A colour theme sets four knobs on `<html data-palette>` (`--palette-hue`, `--palette-chroma`, `--neutral-hue`, `--neutral-tint`) and every §7.12 token is computed from them in both ramps, with new tokens `--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--table-header`, `--table-stripe`; the formulas in `globals.css` replace §7.12's fixed values, and the default `harbor` theme stays close to them. `theme.test.ts` recomputes every text pair (≥ 4.5 : 1) and field outline (≥ 3 : 1) for every theme in light and dark. `pallet.prefs.v1` gains `palette` and `font` (defaults `harbor`, `inter`); `boot-prefs.js` validates them. Print pages mark `<html data-force-light>` so neither dark nor system can darken a receipt. Lists sit in a card with a tinted header and striped rows; figures carry a tone (icon chip and top bar); payment types are pills. |

## 3. Actors, roles and permissions

### 3.1 Actors

| Actor | System user? | Description |
|---|---|---|
| Admin | Yes, `role = ADMIN` | Holds every permission implicitly (grantable and admin-only); cannot have permissions removed. Creates users, assigns employee permissions, edits factory settings, may override the credit-limit block. |
| Employee | Yes, `role = EMPLOYEE` | Holds only the grantable permission keys stored for them in `user_permissions`. |
| Customer company | No | A `customers` row. Never logs in. |
| Driver | No | A `drivers` row (name, phone, car number) attached to orders. Never logs in. |

There is no self-registration; admins create every account. The first admin is created by the first-run seed from `ADMIN_USERNAME`/`ADMIN_PASSWORD` with `mustChangePassword = true`.

### 3.2 Definitive permission key list

Constants live in `packages/shared/src/permissions.ts` (`GRANTABLE_PERMISSION_KEYS`, `ADMIN_ONLY_PERMISSION_KEYS`, `PERMISSION_DEPENDENCIES`). Pattern: `<module>.<action>`. i18n label key: `permissions.<key with "." replaced by "_">` (`permissions.items_viewCost`).

| # | Key | Module | Grants | Depends on | Admin-only? |
|---|---|---|---|---|---|
| 1 | `items.view` | items | List and view items (on hand, out, damaged, low-stock), item stock-movement history; item pickers. | — | No |
| 2 | `items.create` | items | Create items (with optional initial batch if also `purchases.create`); upload item images. | items.view | No |
| 3 | `items.edit` | items | Edit item name, deposit price, minStock, image; upload item images. | items.view | No |
| 4 | `items.delete` | items | Archive items. | items.view | No |
| 5 | `items.viewCost` | items | See batch `unitCost`/`totalCost` in item detail, batch lists, reports and audit before/after data. Without it the API strips these fields. | items.view | No |
| 6 | `items.adjustStock` | items | Record manual stock adjustments (`MANUAL_ADJUSTMENT`). | items.view | No |
| 7 | `purchases.view` | purchases | List purchase batches (dates, quantities; costs only with `items.viewCost`). | items.view | No |
| 8 | `purchases.create` | purchases | Add purchase batches (including the initial batch on item creation). | purchases.view | No |
| 9 | `purchases.edit` | purchases | Edit purchase batches (`BATCH_EDIT`). | purchases.view | No |
| 10 | `purchases.delete` | purchases | Delete (soft) purchase batches (`BATCH_DELETE`). | purchases.view | No |
| 11 | `customers.view` | customers | List/view customers, profile summary and holdings, phone-duplicate check; customer pickers. | — | No |
| 12 | `customers.create` | customers | Create customers. | customers.view | No |
| 13 | `customers.edit` | customers | Edit customers (including credit limit). | customers.view | No |
| 14 | `customers.delete` | customers | Archive customers. | customers.view | No |
| 15 | `drivers.view` | drivers | List/view drivers; driver pickers. | — | No |
| 16 | `drivers.create` | drivers | Create drivers. | drivers.view | No |
| 17 | `drivers.edit` | drivers | Edit drivers. | drivers.view | No |
| 18 | `drivers.delete` | drivers | Archive drivers. | drivers.view | No |
| 19 | `orders.view` | orders | List/view orders, their returns and ledger rows; customer history, payments and refunds lists; print receipts. | customers.view, drivers.view, items.view | No |
| 20 | `orders.create` | orders | Create orders (hand-overs). | orders.view | No |
| 21 | `orders.edit` | orders | Edit order header (driver, date, notes) and lines (while no activity). | orders.view | No |
| 22 | `orders.cancel` | orders | Cancel orders (while no activity). | orders.view | No |
| 23 | `orders.editUnitDeposit` | orders | Supply a `unitDeposit` different from the item's current price on create or line edit. | orders.edit | No |
| 24 | `returns.create` | returns | Record returns. | orders.view | No |
| 25 | `returns.edit` | returns | Edit (replace) returns. | returns.create | No |
| 26 | `returns.delete` | returns | Delete (reverse) returns. | orders.view | No |
| 27 | `payments.create` | payments | Record manual payments on `LENT` orders. | orders.view | No |
| 28 | `payments.delete` | payments | Delete (reverse) manual payments. | orders.view | No |
| 29 | `reports.viewPositions` | reports | Report 1 (pallets out & money position) and the dashboard positions cards. | — | No |
| 30 | `reports.viewPurchases` | reports | Report 2 (purchases by period). | items.viewCost | No |
| 31 | `reports.viewActivity` | reports | Report 3 (activity by period). | — | No |
| 32 | `reports.viewStock` | reports | Report 4 (stock levels). | — | No |
| 33 | `audit.view` | audit | History page (audit log). | — | No |
| 34 | `users.manage` | users | Every `/api/users` endpoint: create, edit, deactivate, reset password, set permissions, log a user out everywhere. | — | **Yes** |
| 35 | `settings.edit` | settings | `PUT /api/settings` and factory logo upload. | — | **Yes** |
| 36 | `orders.overrideCreditLimit` | orders | Confirm a credit-limit override (`confirmCreditOverride = true`). | — | **Yes** |

### 3.3 Rules

1. **Admin**: effective permission set = all 36 keys. `PUT /api/users/:id/permissions` on an admin returns 409 `PERMISSIONS_ADMIN_IMPLICIT`; admins have no `user_permissions` rows (demoting an admin to employee starts them with an empty set; promoting an employee deletes their rows in the same transaction).
2. **Employee**: effective set = the stored rows. A stored set must contain only grantable keys (`PERMISSION_KEY_UNKNOWN` for unknown keys, `PERMISSION_NOT_GRANTABLE` for admin-only keys) and must be closed under `PERMISSION_DEPENDENCIES` (`PERMISSION_DEPENDENCY_MISSING`, `details.missing` sorted).
3. **Admin-only operations** are checked by role (`@AdminOnly()` → 403 `ADMIN_ONLY`), never by a stored key. The three admin-only keys exist so the UI and `GET /api/auth/me` can express them uniformly.
4. **Loaded per request**: the JWT carries only `sub` (user id) and `tv` (token version). `AuthGuard` loads `users` (`is_active`, `role`, `token_version`, `must_change_password`) plus `user_permissions` on **every** request (one query with a join) and attaches `req.user = { id, username, displayName, role, permissions: Set<PermissionKey>, mustChangePassword }`. A role or permission change therefore applies on the user's next request without logging them out.
5. **Enforcement**: every controller handler declares exactly one of `@Public()`, `@Authenticated()`, `@AdminOnly()`, `@RequirePermission(...keys)` (all listed keys required) or `@RequireAnyPermission(...keys)` (at least one). `PermissionDeclarationCheck` fails application start-up if any route lacks a declaration; a unit test boots `AppModule` so CI catches it. The web app uses the same keys (from `GET /api/auth/me`) only to hide or disable UI.
6. **Guards (global, in order)**: `AppThrottlerGuard` → `CsrfGuard` → `AuthGuard` → `PasswordChangeGuard` → `PermissionGuard`.
7. **Self and last-admin guards**: a user cannot deactivate (`SELF_DEACTIVATE_FORBIDDEN`) or demote (`SELF_DEMOTE_FORBIDDEN`) themselves; the last active admin cannot be deactivated or demoted (`LAST_ADMIN_GUARD`, checked with `SELECT id FROM users WHERE role = 'ADMIN' AND is_active FOR UPDATE`).
8. **Default presets** offered by the permission editor (buttons that tick a closed set; purely UI): "Operator" = orders.view, orders.create, returns.create, payments.create, customers.view, customers.create, drivers.view, drivers.create, items.view, reports.viewStock (closure adds nothing else); "Read-only" = every `*.view` key except items.viewCost plus reports.viewPositions, reports.viewActivity, reports.viewStock.

## 4. Domain model and business rules

All money is whole IQD (PostgreSQL `bigint`, JavaScript safe integer). All quantities are integers. Every rule in this section is implemented once, as pure functions in `packages/shared/src/domain/ledger-math.ts` (`computeOrderTotals`, `returnRefundDue`, `returnMoney`, `checkCreditLimit`, `chunkReceiptLines`), and used by the API (authoritative) and by the web app (live previews while typing).

"The customer's orders", "pallets out", "owed", "held" and every derived value **exclude cancelled orders** (section 4.2, "Cancelled orders").

### 4.1 Per order line

```
lineTotal        = quantity × unitDeposit
returnedAccepted = Σ acceptedQuantity over the order's non-reversed returns for this line
returnedDamaged  = Σ damagedQuantity   over the order's non-reversed returns for this line
outQuantity      = quantity − returnedAccepted − returnedDamaged      (must stay ≥ 0)
```

### 4.2 Per order

```
depositTotal   = Σ lineTotal
payments       = Σ PAYMENT amounts − Σ PAYMENT_REVERSAL amounts on this order (includes the automatic CASH payment)
credits        = Σ refundDue over the order's non-reversed returns   (see 4.3)
refundsPaid    = Σ REFUND amounts − Σ REFUND_REVERSAL amounts on this order
owed           = depositTotal − payments − credits + refundsPaid        (always ≥ 0 after each operation)
outValue       = Σ (outQuantity × unitDeposit) over lines
held           = max(0, outValue − owed)
compensation   = Σ (damagedQuantity × unitDeposit − damagedRefund) over non-reversed returns
status         = CANCELLED if cancelledAt is set; else OPEN if (any outQuantity > 0) or owed > 0; else SETTLED
```

Stored column names: `payments` → `orders.payments_net`, `credits` → `orders.credits_total`, `refundsPaid` → `orders.refunds_net`, Σ outQuantity → `orders.out_quantity_total`.

**Cancelled orders**: when `cancelledAt` is set, `outQuantity` of every line, `payments`, `credits`, `refundsPaid`, `owed`, `outValue`, `held`, `compensation` and `outQuantityTotal` are **0** and `status = CANCELLED`; `depositTotal` and `lineTotal` keep their values (they describe the document). Every aggregate query additionally filters `orders.cancelled_at IS NULL` (customer, item, dashboard, reports, credit-limit check), so the zeroing and the filter are two independent safeguards.

### 4.3 Per return

```
refundDue      = Σ (acceptedQuantity × unitDeposit + damagedRefund) over the return's entries
owedBefore     = owed of the order at the moment this return is inserted (ledger insertion order, NOT business-date order)
cashRefund     = max(0, refundDue − owedBefore)      → recorded as a REFUND ledger row on the order when > 0
owedAfter      = max(0, owedBefore − refundDue)
```

`refundDue`, `owedBefore` and `cashRefund` are stored on the `returns` row at insertion and never change (history). `unitDeposit` is copied from the order line onto each `return_lines` row.

**Ordering rule**: money outcomes depend on the sequence in which events were *recorded*, never on business dates. Back-dating an order, return or payment never recomputes any `cashRefund`. Editing or deleting an earlier event (via reversing rows) never recomputes a later return's `cashRefund`; the ledger simply nets out.

Proof that `owed` stays ≥ 0: after a return, `owed' = owedBefore − refundDue + cashRefund = max(0, owedBefore − refundDue) ≥ 0`. A payment is capped at `owed`. Reversing a return adds back `refundDue − cashRefund ≥ 0`. Reversing a payment adds its amount. Line edits are only allowed with no manual payments and no returns, where `owed = depositTotal` (LENT) or `0` (CASH, payment re-issued). Cancellation zeroes everything. The API still asserts `owed ≥ 0` (`LedgerInvariantError` → 500 `INTERNAL_ERROR`, transaction rolled back) and the database enforces `orders_totals_nonnegative_check`.

### 4.4 Credit limit

```
customerOutValue     = Σ outValue over the customer's non-cancelled orders
newOrderDepositTotal = Σ lineTotal of the order being created (or, when editing lines, newDepositTotal − oldDepositTotal)
allowed              = customer.creditLimit is empty
                       OR newOrderDepositTotal ≤ 0            (reducing an order is always allowed)
                       OR customerOutValue + newOrderDepositTotal ≤ customer.creditLimit
excess               = customerOutValue + newOrderDepositTotal − customer.creditLimit   (reported when not allowed)
```

`customerOutValue` is read with `SELECT COALESCE(SUM(out_value), 0)::bigint FROM orders WHERE customer_id = $1 AND cancelled_at IS NULL` **after** the customer row is locked. When editing lines, the order's own current `out_value` is inside `customerOutValue` and `newOrderDepositTotal` is the delta, so the check is exact.

Outcome when not allowed:

| Caller | `confirmCreditOverride` | Result |
|---|---|---|
| Employee | any | 409 `CREDIT_LIMIT_EXCEEDED`, `details = { creditLimit, customerOutValue, depositDelta, excess, canOverride: false }` |
| Admin | absent/false | 409 `CREDIT_LIMIT_EXCEEDED`, same details with `canOverride: true` (UI shows an override confirm dialog) |
| Admin | true | Proceeds; sets `orders.credit_override_by_user_id` and `orders.credit_override_at` (overwritten by a later override on a line edit) and writes audit `CREDIT_OVERRIDE` |

When allowed, `confirmCreditOverride` is ignored and no override is recorded.

### 4.5 Customer aggregates

`owed`, `held`, `outValue`, `compensation`, `outQuantityTotal` and pallets out per item for a customer are **sums of the per-order values** over the customer's non-cancelled orders. `held` is the sum of per-order `held` (never recomputed as `max(0, outValue − owed)` at customer level).

```sql
SELECT COALESCE(SUM(o.out_value),0)::bigint AS out_value, COALESCE(SUM(o.owed),0)::bigint AS owed,
       COALESCE(SUM(o.held),0)::bigint AS held, COALESCE(SUM(o.compensation),0)::bigint AS compensation,
       COALESCE(SUM(o.out_quantity_total),0)::bigint AS out_quantity
FROM orders o WHERE o.customer_id = ${customerId} AND o.cancelled_at IS NULL;

-- pallets out per item (current holdings)
SELECT ol.item_id, SUM(ol.out_quantity)::bigint AS out_quantity, SUM(ol.out_quantity * ol.unit_deposit)::bigint AS out_value
FROM order_lines ol JOIN orders o ON o.id = ol.order_id
WHERE o.customer_id = ${customerId} AND o.cancelled_at IS NULL AND ol.out_quantity > 0
GROUP BY ol.item_id;
```

Remaining headroom = `creditLimit − outValue` when `creditLimit` is set (may be negative after an override; displayed as is), else "no limit".

### 4.6 Storage strategy

| Value | Strategy | Written by | Verified by |
|---|---|---|---|
| Stock movements | Append-only ledger `stock_movements` | Operation services via `StockLedger.apply()` | DB grants + trigger `forbid_update_delete` |
| `items.quantity_on_hand` | Maintained running total | `StockLedger.apply()` only, same transaction as its movements | Reconciliation R1 |
| Money movements | Append-only ledger `ledger_entries` | Operation services via `MoneyLedger` | DB grants + triggers |
| `orders.{status, deposit_total, payments_net, credits_total, refunds_net, owed, out_quantity_total, out_value, held, compensation}` and `order_lines.{returned_accepted, returned_damaged, out_quantity}` | Maintained cache | `recomputeOrder(tx, orderId)` only | Reconciliation R2 |
| `returns.{refund_due, owed_before, cash_refund}` | Immutable history captured at insertion | Return services | CHECK `returns_cash_refund_formula_check` |
| `purchase_batches.total_cost`, `order_lines.line_total`, `return_lines.unit_deposit` | Stored copies | Creating services | CHECK constraints |
| Item `quantityOut`, `damagedTotal`, `isLowStock` | Computed on read (SQL) | — | — |
| Customer `outValue`, `owed`, `held`, `compensation`, per-item holdings | Computed on read (SQL sums of maintained order columns) | — | — |
| Ledger effective date | Computed on read: `COALESCE(le.date, o.date)` | — | — |
| Order number | Allocated from `order_counter` | Order creation only | Reconciliation R5 |

`recomputeOrder(tx, orderId, { bumpVersion })` — the only writer of the order cache:

1. Read the order (`cancelled_at`), its lines (`id`, `quantity`, `unit_deposit`), all its returns (`reversed_at`) with their lines, and all its ledger rows (`type`, `amount`), inside `tx`.
2. Call `computeOrderTotals({ cancelled, lines, returns, ledger })`.
3. `UPDATE order_lines SET returned_accepted, returned_damaged, out_quantity, updated_at` for each line whose values changed.
4. `UPDATE orders SET status, deposit_total, payments_net, credits_total, refunds_net, owed, out_quantity_total, out_value, held, compensation, updated_at` and, when `bumpVersion`, `version = version + 1`.
5. Return the totals to the caller (used for the response).

`bumpVersion` is `false` only inside order creation. `recomputeOrder` is called at the end of every transaction that touches an order.

`StockLedger.apply(tx, movements[], ctx)` — the only writer of `quantity_on_hand`:

1. Precondition: every item in `movements` is already locked by the caller (`FOR UPDATE`, ascending id).
2. Group by `itemId`; `net = Σ quantity`.
3. For each item: if `quantityOnHand + net < 0`, collect `{ itemId, requested: −net, available: quantityOnHand }`. If any collected → throw `STOCK_INSUFFICIENT` with `details.items` (rolls back the transaction).
4. Insert all movement rows (`createMany`) with `created_by_user_id = ctx.userId`.
5. For each item with `net ≠ 0`: `UPDATE items SET quantity_on_hand = quantity_on_hand + net WHERE id = :itemId` (does not touch `version` or `updated_at`).

### 4.7 Ledgers

#### 4.7.1 Stock movement reasons (exhaustive)

| Reason | Sign | Created by | Reference columns | Quantity |
|---|---|---|---|---|
| `BATCH_ADD` | + | Batch creation (including the initial batch on item creation) | `batch_id` | `+batch.quantity` |
| `BATCH_EDIT` | ± | Batch edit that changes quantity | `batch_id` | `newQuantity − oldQuantity` (row only if ≠ 0) |
| `BATCH_DELETE` | − | Batch deletion (soft) | `batch_id` | `−batch.quantity` |
| `ORDER_CREATE` | − | Order creation | `order_id` | `−line.quantity` per line |
| `ORDER_LINE_EDIT` | ± | Order line edit | `order_id` | per item `−(newQuantity − oldQuantity)`; removed line `+oldQuantity`; added line `−newQuantity` (row only if ≠ 0) |
| `ORDER_CANCEL` | + | Order cancellation | `order_id` | `+line.quantity` per line |
| `RETURN_ACCEPTED` | + | Return creation, and the replacement return of a return edit | `return_id` (new return), `order_id` | `+acceptedQuantity` per entry with accepted > 0 |
| `RETURN_EDIT` | − | Return edit (undoing the replaced return) | `return_id` (old return), `order_id` | `−acceptedQuantity` per old entry with accepted > 0 |
| `RETURN_DELETE` | − | Return deletion | `return_id`, `order_id` | `−acceptedQuantity` per entry with accepted > 0 |
| `MANUAL_ADJUSTMENT` | ± | Manual stock adjustment | none; `note` required | signed quantity ≠ 0 |

Damaged pallets never create stock movements.

#### 4.7.2 Money ledger rows (exhaustive)

| Type | Source | `is_automatic` | `date` | `return_id` | `reverses_entry_id` | Created by |
|---|---|---|---|---|---|---|
| `PAYMENT` | `ORDER_CREATE` | true | NULL (effective = order date) | NULL | NULL | Creation of a `CASH` order with `depositTotal > 0` |
| `PAYMENT` | `ORDER_LINE_EDIT` | true | NULL | NULL | NULL | Any line change of a `CASH` order (even when the total is unchanged), when the new total > 0 |
| `PAYMENT` | `MANUAL` | false | payment date | NULL | NULL | Manual payment on a `LENT` order |
| `PAYMENT_REVERSAL` | `ORDER_LINE_EDIT` | false | today | NULL | the old automatic payment | Any line change of a `CASH` order (even when the total is unchanged), when a non-reversed automatic payment exists |
| `PAYMENT_REVERSAL` | `ORDER_CANCEL` | false | today | NULL | the automatic payment | Cancellation of a `CASH` order that has a non-reversed automatic payment |
| `PAYMENT_REVERSAL` | `PAYMENT_DELETE` | false | today | NULL | the manual payment | Deleting a manual payment |
| `REFUND` | `RETURN_CREATE` | false | return date | the return | NULL | Return creation with `cashRefund > 0` |
| `REFUND` | `RETURN_EDIT` | false | new return date | the replacement return | NULL | Return edit whose replacement return has `cashRefund > 0` |
| `REFUND_REVERSAL` | `RETURN_EDIT` | false | today | the replaced (old) return | the old return's REFUND | Return edit when the old return had a non-reversed REFUND |
| `REFUND_REVERSAL` | `RETURN_DELETE` | false | today | the deleted return | the return's REFUND | Return deletion when the return had a non-reversed REFUND |

"Today" = the Asia/Baghdad calendar day at recording time. Every row has `amount > 0`, `created_at`, `created_by_user_id`, optional `note` (≤ 500 chars; manual payments and payment deletions accept a user note). A row is *reversed* when another row has `reverses_entry_id = row.id` (unique, so at most once). The database enforces the table above (`ledger_entries_source_matches_type_check`, `ledger_entries_date_null_only_automatic_check`, `ledger_entries_return_reference_check`, trigger `ledger_reversal_matches_original`).

### 4.8 Operations (each is ONE interactive Prisma transaction)

Transaction helper: `prisma.$transaction(fn, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 })`. Row locks are taken with raw tagged-template queries from `apps/api/src/prisma/locks.ts` **before** any check, in the fixed global order **customer → order → items (ascending id) → order_counter**:

```ts
lockCustomer(tx, id)   // SELECT id FROM customers WHERE id = ${id} FOR UPDATE
lockOrder(tx, id)      // SELECT id FROM orders WHERE id = ${id} FOR UPDATE
lockItems(tx, ids)     // SELECT id FROM items WHERE id = ANY(${sortedUniqueIds}::int[]) ORDER BY id FOR UPDATE
lockOrderCounter(tx)   // SELECT last_number FROM order_counter WHERE id = 1 FOR UPDATE
```

`SERIALIZABLE` isolation is not used. Every transaction writes its audit rows (section 11) before commit. Where an operation takes an `Idempotency-Key`, the key row is the last insert (section 6, idempotency). "Not found" checks after locking use the entity's `*_NOT_FOUND` code. `today` = Asia/Baghdad calendar day.

#### 4.8.1 Create order — `POST /api/orders` (orders.create; locks: customer, items, counter)

1. (Before the transaction) validate the body with `createOrderSchema`; resolve the idempotency key (replay / `IDEMPOTENCY_KEY_REUSED` / continue).
2. `lockCustomer(customerId)`; load it. Missing → `CUSTOMER_NOT_FOUND`; archived → `CUSTOMER_ARCHIVED`.
3. Load the driver. Missing → `DRIVER_NOT_FOUND`; archived → `DRIVER_ARCHIVED`.
4. `date ≤ today` else `BUSINESS_DATE_IN_FUTURE`.
5. `lockItems(line itemIds)`; load them. Missing → `ITEM_NOT_FOUND` (`details.itemId`); archived → `ITEM_ARCHIVED` (`details.itemId`). Duplicate item ids were already rejected by the schema (`VALIDATION_FAILED` with `duplicate` on the repeated line, Q38).
6. Unit deposits: a line with `unitDeposit` supplied requires `orders.editUnitDeposit` (admins always) else 403 `UNIT_DEPOSIT_NOT_PERMITTED`; a line without it gets `item.depositPrice`. `lineTotal = quantity × unitDeposit`; `depositTotal = Σ lineTotal`.
7. Stock: every line `quantity ≤ item.quantityOnHand` else `STOCK_INSUFFICIENT` listing every short line.
8. Credit limit (section 4.4) with `depositDelta = depositTotal`; employees blocked, admins may override.
9. `lockOrderCounter()`; `orderNumber = last_number + 1`; `UPDATE order_counter SET last_number = orderNumber`.
10. Insert `orders` (`status OPEN`, cache columns default 0, `version 1`, override columns when overridden) and `order_lines` (`out_quantity = quantity`).
11. `StockLedger.apply`: `ORDER_CREATE` `−quantity` per line.
12. If `paymentType = CASH` and `depositTotal > 0`: insert `PAYMENT / ORDER_CREATE / is_automatic / date NULL / amount depositTotal`.
13. `recomputeOrder(orderId, { bumpVersion: false })`.
14. Audit: `ORDER CREATE` (after = order snapshot), `LEDGER_ENTRY PAYMENT_CREATE` for the automatic payment, `ORDER CREDIT_OVERRIDE` when overridden.
15. Insert the idempotency key row with the 201 response body. Commit. Respond 201 with `OrderDetailDto`.

#### 4.8.2 Edit order — `PATCH /api/orders/:id` (orders.edit; locks: customer, order, items)

1. Validate body; read `orders.customer_id` (unlocked); `lockCustomer`; `lockOrder`; reload the order. `version` mismatch → `VERSION_CONFLICT` (`details.currentVersion`); cancelled → `ORDER_CANCELLED`.
2. `hasActivity` = exists a non-reversed return OR a non-reversed ledger row with `type = PAYMENT AND source = MANUAL`.
3. Header: `driverId` changed → driver must exist and not be archived; `date` changed → `≤ today`, and `≤` the earliest `date` of non-reversed returns and non-reversed manual payments else `ORDER_DATE_AFTER_ACTIVITY`; `notes` free.
4. If `lines` is present: `hasActivity` → `ORDER_HAS_ACTIVITY`. Diff by `itemId` between stored and requested lines. `lockItems(union of old and new item ids)`. Added items must exist and not be archived; an existing line whose item is archived may be kept, reduced or removed, and increasing it → `ITEM_ARCHIVED`. Unit deposits per Q15. Movements `ORDER_LINE_EDIT` per item (section 4.7.1). `depositDelta = newDepositTotal − oldDepositTotal`; if `> 0` run the credit check (section 4.4). Apply line changes: update changed lines (`quantity`, `unit_deposit`, `line_total`, `out_quantity = quantity`), delete removed lines, insert added lines. `StockLedger.apply`.
5. If `lines` changed on a `CASH` order (any added, removed or changed line, even when the total is unchanged; each step is skipped only when its amount would be 0): if a non-reversed automatic payment exists, insert `PAYMENT_REVERSAL / ORDER_LINE_EDIT / date today / reverses it`; if `newDepositTotal > 0`, insert `PAYMENT / ORDER_LINE_EDIT / is_automatic / date NULL / amount newDepositTotal`.
6. `recomputeOrder({ bumpVersion: true })`. Audit `ORDER UPDATE` (before/after snapshots), plus `PAYMENT_REVERSE`/`PAYMENT_CREATE` for re-issued automatic payments and `CREDIT_OVERRIDE` when used. Respond 200 `OrderDetailDto`.

#### 4.8.3 Cancel order — `POST /api/orders/:id/cancel` (orders.cancel; locks: customer, order, items)

1. `lockCustomer`, `lockOrder`, reload; `version` check; already cancelled → `ORDER_CANCELLED`; `hasActivity` → `ORDER_HAS_ACTIVITY`.
2. `lockItems(line itemIds)`; `StockLedger.apply`: `ORDER_CANCEL` `+quantity` per line.
3. If a non-reversed automatic payment exists: insert `PAYMENT_REVERSAL / ORDER_CANCEL / date today`.
4. Set `cancelled_at = now()`, `cancelled_by_user_id`. `recomputeOrder({ bumpVersion: true })` (status `CANCELLED`, cache zeroed).
5. Audit `ORDER CANCEL` (+ `PAYMENT_REVERSE`). Respond 200 `OrderDetailDto`.

#### 4.8.4 Create return — `POST /api/orders/:orderId/returns` (returns.create; locks: order, items)

1. Validate body; resolve idempotency key. Entries with `acceptedQuantity = 0 AND damagedQuantity = 0` (and no `damagedRefund`) are dropped by the schema (Q41); if none remain → `RETURN_EMPTY`. Duplicate `orderLineId` → `RETURN_DUPLICATE_LINE`.
2. `lockOrder`; reload with lines. Missing → `ORDER_NOT_FOUND`; cancelled → `ORDER_CANCELLED`. Each `orderLineId` must belong to the order → `RETURN_LINE_NOT_IN_ORDER`. `date ≤ today` and `date ≥ order.date` (`RETURN_DATE_BEFORE_ORDER_DATE`).
3. `lockItems(item ids of the involved lines)`.
4. Per entry: `accepted + damaged ≤ line.out_quantity` else `RETURN_EXCEEDS_OUT` (`details.lines = [{ orderLineId, requested, outQuantity }]`); `damagedRefund ≤ damagedQuantity × line.unitDeposit` else `DAMAGED_REFUND_TOO_HIGH` (`details = { orderLineId, maximum }`, as the error table).
5. `owedBefore = order.owed` (maintained value, consistent under the order lock); `refundDue = returnRefundDue(entries)`; `{ cashRefund } = returnMoney(owedBefore, refundDue)`.
6. Insert `returns` (`refund_due`, `owed_before`, `cash_refund`) and `return_lines` (with `unit_deposit` copied from the line).
7. `StockLedger.apply`: `RETURN_ACCEPTED +accepted` per entry with accepted > 0.
8. If `cashRefund > 0`: insert `REFUND / RETURN_CREATE / date = return date / return_id / amount cashRefund`.
9. `recomputeOrder({ bumpVersion: true })`. Audit `RETURN RETURN_CREATE` (+ `LEDGER_ENTRY REFUND_CREATE`). Idempotency key row. Respond 201 `ReturnResultDto` (`{ returnId, order }`, §6.20).

#### 4.8.5 Edit return — `POST /api/returns/:id/replace` (returns.edit; locks: customer, order, items)

1. Validate body (same schema as create). Read `returns.order_id` and the order's `customer_id` (unlocked); `lockCustomer` (Q47); `lockOrder`; reload order and the old return. Old return reversed → `RETURN_ALREADY_REVERSED`.
2. Validate entries as in 4.8.4 steps 1–2 (`date ≥ order.date`, lines belong to order).
3. `lockItems(union of item ids of the old return's lines and the new entries)`.
4. Compute the **state without the old return**: `computeOrderTotals` with the old return marked reversed and the old return's REFUND (if any, non-reversed) netted by its reversal. Validate new entries against those `outQuantity` values (`RETURN_EXCEEDS_OUT`) and damaged refund caps. `owedBefore` = that state's `owed`.
5. Writes, in this order: (a) movements `RETURN_EDIT −oldAccepted` (return_id = old) and, after step (c), `RETURN_ACCEPTED +newAccepted` (return_id = new) — both passed to one `StockLedger.apply` call so the negativity check uses the per-item net (Q20); (b) if the old return has a non-reversed REFUND: `REFUND_REVERSAL / RETURN_EDIT / date today / return_id = old / reverses it`; (c) insert the new `returns` row + `return_lines` with `refundDue`, `owedBefore`, `cashRefund = max(0, refundDue − owedBefore)`; (d) if new `cashRefund > 0`: `REFUND / RETURN_EDIT / date = new return date / return_id = new`; (e) one statement `UPDATE returns SET reversed_at = now(), reversed_by_user_id = :userId, reversal_kind = 'EDIT', replaced_by_return_id = :newId WHERE id = :oldId`.
6. `recomputeOrder({ bumpVersion: true })`. Audit `RETURN RETURN_EDIT` (entityId = old id; before = old return, after = new return) + `REFUND_REVERSE` / `REFUND_CREATE` as applicable. Respond 201 `ReturnResultDto` (`returnId` = the new return). No idempotency key (a retried replace fails safely with `RETURN_ALREADY_REVERSED`).

#### 4.8.6 Delete return — `DELETE /api/returns/:id` (returns.delete; locks: customer, order, items)

1. `lockCustomer` (Q47); `lockOrder`; reload; reversed → `RETURN_ALREADY_REVERSED`.
2. `lockItems(item ids of its lines)`; `StockLedger.apply`: `RETURN_DELETE −accepted` per entry with accepted > 0 (may fail with `STOCK_INSUFFICIENT` if those pallets were lent out again).
3. If it has a non-reversed REFUND: `REFUND_REVERSAL / RETURN_DELETE / date today / return_id / reverses it`.
4. `UPDATE returns SET reversed_at, reversed_by_user_id, reversal_kind = 'DELETE'`.
5. `recomputeOrder({ bumpVersion: true })`. Audit `RETURN RETURN_DELETE` (+ `REFUND_REVERSE`). Respond 200 `ReturnResultDto` (`returnId` = the deleted return).

#### 4.8.7 Create payment — `POST /api/orders/:orderId/payments` (payments.create; locks: order)

1. Validate body (`date`, `amount` 1..MONEY_INPUT_MAX, `note?`); resolve idempotency key.
2. `lockOrder`; reload. Cancelled → `ORDER_CANCELLED`; `paymentType ≠ LENT` → `PAYMENT_ORDER_NOT_LENT`; `date ≤ today` and `≥ order.date` (`PAYMENT_DATE_BEFORE_ORDER_DATE`); `amount ≤ order.owed` else `PAYMENT_EXCEEDS_OWED` (`details.owed`).
3. Insert `PAYMENT / MANUAL / date / amount / note`. `recomputeOrder({ bumpVersion: true })`.
4. Audit `LEDGER_ENTRY PAYMENT_CREATE`. Idempotency key row. Respond 201 `PaymentResultDto` (`{ ledgerEntryId, order }`, §6.21).

#### 4.8.8 Reverse (delete) payment — `POST /api/ledger-entries/:id/reverse` (payments.delete; locks: order)

1. Read `ledger_entries.order_id`; `lockOrder`; reload the entry. Not `type = PAYMENT AND source = MANUAL` → `LEDGER_ENTRY_NOT_REVERSIBLE`; already reversed → `LEDGER_ENTRY_ALREADY_REVERSED`.
2. Insert `PAYMENT_REVERSAL / PAYMENT_DELETE / date today / reverses_entry_id / amount / note`. `recomputeOrder({ bumpVersion: true })`.
3. Audit `LEDGER_ENTRY PAYMENT_REVERSE`. Respond 200 `PaymentResultDto` (`ledgerEntryId` = the reversal row).

#### 4.8.9 Batches and stock adjustment (locks: item)

- **Add batch** (`POST /api/purchase-batches`, purchases.create): `lockItems([itemId])`; missing → `ITEM_NOT_FOUND`; archived → `ITEM_ARCHIVED`; `date ≤ today`; insert batch with `total_cost = quantity × unit_cost`; `StockLedger.apply(BATCH_ADD +quantity)`; audit `PURCHASE_BATCH CREATE`.
- **Edit batch** (`PATCH /api/purchase-batches/:id`, purchases.edit): read `item_id`; `lockItems([itemId])`; reload batch; deleted → `BATCH_NOT_FOUND`; `version` check; `itemId` is immutable; if quantity changed `StockLedger.apply(BATCH_EDIT new − old)`; update fields, `total_cost`, `version + 1`; audit `PURCHASE_BATCH UPDATE`.
- **Delete batch** (`DELETE /api/purchase-batches/:id?version=N`, purchases.delete): `lockItems([itemId])`; reload; `version` check; `StockLedger.apply(BATCH_DELETE −quantity)`; set `deleted_at`, `deleted_by_user_id`, `version + 1`; audit `PURCHASE_BATCH DELETE`.
- **Create item with initial batch** (`POST /api/items`, items.create + purchases.create for the batch): insert item (`quantity_on_hand 0`), then the add-batch steps in the same transaction; audit `ITEM CREATE` and `PURCHASE_BATCH CREATE`.
- **Manual adjustment** (`POST /api/items/:id/stock-adjustments`, items.adjustStock): `lockItems([id])`; archived items may be adjusted; `StockLedger.apply(MANUAL_ADJUSTMENT ±quantity, note)`; audit `ITEM STOCK_ADJUST` (`summaryParams = { itemName, quantity }`).

### 4.9 Invariants

| # | Invariant | Enforced by |
|---|---|---|
| I1 | `items.quantity_on_hand = Σ stock_movements.quantity` for the item, and `≥ 0`. | `StockLedger.apply`, CHECK, reconciliation R1 |
| I2 | For every line: `out_quantity = quantity − returned_accepted − returned_damaged ≥ 0` over non-reversed returns. | Return checks under the order lock, `recomputeOrder`, CHECKs, R2 |
| I3 | `orders.owed ≥ 0` and every cache column `≥ 0`. | Section 4.3 proof, runtime assertion, CHECK |
| I4 | Every order's cache columns equal `computeOrderTotals` of its source rows. | `recomputeOrder`, R2 |
| I5 | Each ledger reversal mirrors exactly one earlier row (same order, amount, matching type); no row is reversed twice. | Unique `reverses_entry_id`, trigger |
| I6 | A non-cancelled `CASH` order has exactly one non-reversed automatic payment of `depositTotal` when `depositTotal > 0` (none when 0) and no manual payments. | Order services, R3 |
| I7 | A cancelled order has no non-reversed returns, no non-reversed payments, and its stock movements net to 0 per item. | Cancel gate, R4 |
| I8 | Order numbers are exactly 1..N with `N = order_counter.last_number`. | Locked counter, unique index, R5 |
| I9 | For every batch: Σ of its `BATCH_*` movements = `quantity` if not deleted, else 0. | Batch services, R6 |
| I10 | For every return: its non-reversed or reversed REFUND amount equals `cash_refund`, and a REFUND exists iff `cash_refund > 0`. | Return services, R7 |
| I11 | Returns and ledger/stock/audit rows are never modified or deleted (except Q5). | Grants, triggers |

**Reconciliation** (`apps/api/src/scripts/reconcile.ts`, run as `pnpm --filter @pallet/api reconcile`, exit code 1 on any difference, and executed at the end of every integration test file):

- R1 `SELECT i.id FROM items i LEFT JOIN (SELECT item_id, SUM(quantity) q FROM stock_movements GROUP BY item_id) m ON m.item_id = i.id WHERE i.quantity_on_hand <> COALESCE(m.q, 0)`.
- R2 For every order: load source rows, run `computeOrderTotals`, compare with stored cache columns (order and lines).
- R3 `CASH` orders not cancelled: count and amount of non-reversed automatic payments vs `deposit_total`; count of manual payments = 0.
- R4 Cancelled orders: non-reversed returns = 0, `payments_net`-equivalent from ledger = 0, stock movements per (order, item) sum to 0.
- R5 `SELECT COUNT(*), MIN(order_number), MAX(order_number) FROM orders` equals `(last_number, 1, last_number)` (or `(0, NULL, NULL)`).
- R6 Batch movement sums vs `quantity`/`deleted_at`.
- R7 Return REFUND rows vs `cash_refund`.

### 4.10 Worked examples (the builder reproduces every one as a unit test on `ledger-math` and as an integration test through the API)

Common setup: item **P** "Pallet 120×100", `depositPrice = 1,000`, `quantityOnHand = 500` before each example; customer **C** without credit limit; driver **D**; today = 2026-09-11. Ledger rows are numbered in insertion order (#1 is the first row of the order). "Stock" = P's `quantityOnHand` after the step.

**E1 — CASH, full accepted return**

| Step | Ledger rows | Stock movements | Stock | depositTotal | payments | credits | refundsPaid | owed | outValue | held | compensation | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Create CASH 100 × 1,000 | #1 PAYMENT 100,000 (ORDER_CREATE, automatic, date NULL) | ORDER_CREATE −100 | 400 | 100,000 | 100,000 | 0 | 0 | 0 | 100,000 | 100,000 | 0 | OPEN |
| Return R1: 100 accepted. refundDue 100,000; owedBefore 0; cashRefund 100,000; owedAfter 0 | #2 REFUND 100,000 (RETURN_CREATE, R1) | RETURN_ACCEPTED +100 | 500 | 100,000 | 100,000 | 100,000 | 100,000 | 0 | 0 | 0 | 0 | SETTLED |

**E2 — CASH, accepted + damaged (no damage refund)**

| Step | Ledger rows | Stock movements | Stock | depositTotal | payments | credits | refundsPaid | owed | outValue | held | compensation | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Create CASH 100 × 1,000 | #1 PAYMENT 100,000 (automatic) | ORDER_CREATE −100 | 400 | 100,000 | 100,000 | 0 | 0 | 0 | 100,000 | 100,000 | 0 | OPEN |
| Return R1: 90 accepted + 10 damaged, damagedRefund 0. refundDue 90,000; owedBefore 0; cashRefund 90,000 | #2 REFUND 90,000 (R1) | RETURN_ACCEPTED +90 | 490 | 100,000 | 100,000 | 90,000 | 90,000 | 0 | 0 | 0 | 10,000 | SETTLED |

Item P: `damagedTotal = 10`.

**E3 — LENT, accepted + damaged, customer still owes compensation**

| Step | Ledger rows | Stock movements | Stock | depositTotal | payments | credits | refundsPaid | owed | outValue | held | compensation | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Create LENT 100 × 1,000 | none | ORDER_CREATE −100 | 400 | 100,000 | 0 | 0 | 0 | 100,000 | 100,000 | 0 | 0 | OPEN |
| Return R1: 90 accepted + 10 damaged, damagedRefund 0. refundDue 90,000; owedBefore 100,000; cashRefund 0; owedAfter 10,000 | none | RETURN_ACCEPTED +90 | 490 | 100,000 | 0 | 90,000 | 0 | 10,000 | 0 | 0 | 10,000 | OPEN |

**E4 — LENT, damaged only**

| Step | Ledger rows | Stock movements | Stock | depositTotal | payments | credits | refundsPaid | owed | outValue | held | compensation | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Create LENT 100 × 1,000 | none | ORDER_CREATE −100 | 400 | 100,000 | 0 | 0 | 0 | 100,000 | 100,000 | 0 | 0 | OPEN |
| Return R1: 0 accepted + 50 damaged, damagedRefund 0. refundDue 0; owedBefore 100,000; cashRefund 0; owedAfter 100,000 | none | none (damaged never moves stock) | 400 | 100,000 | 0 | 0 | 0 | 100,000 | 50,000 | 0 | 50,000 | OPEN |

`owed` 100,000 = 50,000 for the 50 pallets still out + 50,000 compensation.

**E5 and E6 — LENT, partial payment, two returns**

| Step | Ledger rows | Stock movements | Stock | depositTotal | payments | credits | refundsPaid | owed | outValue | held | compensation | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Create LENT 100 × 1,000 | none | ORDER_CREATE −100 | 400 | 100,000 | 0 | 0 | 0 | 100,000 | 100,000 | 0 | 0 | OPEN |
| Manual payment 40,000 | #1 PAYMENT 40,000 (MANUAL) | none | 400 | 100,000 | 40,000 | 0 | 0 | 60,000 | 100,000 | 40,000 | 0 | OPEN |
| E5 — Return R1: 50 accepted. refundDue 50,000; owedBefore 60,000; cashRefund 0; owedAfter 10,000 | none | RETURN_ACCEPTED +50 | 450 | 100,000 | 40,000 | 50,000 | 0 | 10,000 | 50,000 | 40,000 | 0 | OPEN |
| E6 — Return R2: 50 accepted. refundDue 50,000; owedBefore 10,000; cashRefund 40,000; owedAfter 0 | #2 REFUND 40,000 (R2) | RETURN_ACCEPTED +50 | 500 | 100,000 | 40,000 | 100,000 | 40,000 | 0 | 0 | 0 | 0 | SETTLED |

**E7 — CASH line edit before any activity**

| Step | Ledger rows | Stock movements | Stock | depositTotal | payments | credits | refundsPaid | owed | outValue | held | status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Create CASH 100 × 1,000 | #1 PAYMENT 100,000 (ORDER_CREATE, automatic) | ORDER_CREATE −100 | 400 | 100,000 | 100,000 | 0 | 0 | 0 | 100,000 | 100,000 | OPEN |
| Edit line to 60 × 1,000 (depositDelta −40,000 → no credit check) | #2 PAYMENT_REVERSAL 100,000 (ORDER_LINE_EDIT, date today, reverses #1); #3 PAYMENT 60,000 (ORDER_LINE_EDIT, automatic, date NULL) | ORDER_LINE_EDIT +40 | 440 | 60,000 | 60,000 | 0 | 0 | 0 | 60,000 | 60,000 | OPEN |

**E8 — CASH, return recorded then deleted**

| Step | Ledger rows | Stock movements | Stock | depositTotal | payments | credits | refundsPaid | owed | outValue | held | status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Create CASH 100 × 1,000 | #1 PAYMENT 100,000 (automatic) | ORDER_CREATE −100 | 400 | 100,000 | 100,000 | 0 | 0 | 0 | 100,000 | 100,000 | OPEN |
| Return R1: 50 accepted. refundDue 50,000; owedBefore 0; cashRefund 50,000 | #2 REFUND 50,000 (RETURN_CREATE, R1) | RETURN_ACCEPTED +50 | 450 | 100,000 | 100,000 | 50,000 | 50,000 | 0 | 50,000 | 50,000 | OPEN |
| Delete R1 (reversal_kind DELETE) | #3 REFUND_REVERSAL 50,000 (RETURN_DELETE, date today, reverses #2) | RETURN_DELETE −50 | 400 | 100,000 | 100,000 | 0 | 0 | 0 | 100,000 | 100,000 | OPEN |

**E9 — Cancellation**

| Step | Ledger rows | Stock movements | Stock | owed | outValue | held | status | Customer C outValue |
|---|---|---|---|---|---|---|---|---|
| Create LENT 100 × 1,000 | none | ORDER_CREATE −100 | 400 | 100,000 | 100,000 | 0 | OPEN | 100,000 |
| Cancel | none | ORDER_CANCEL +100 | 500 | 0 | 0 | 0 | CANCELLED | 0 |
| (variant) Create CASH 100 × 1,000, then cancel | #1 PAYMENT 100,000 (automatic); #2 PAYMENT_REVERSAL 100,000 (ORDER_CANCEL, date today) | ORDER_CREATE −100; ORDER_CANCEL +100 | 500 | 0 | 0 | 0 | CANCELLED | 0 |

**E10 — Return edit on a CASH order (additional)**

| Step | Ledger rows | Stock movements | Stock | depositTotal | payments | credits | refundsPaid | owed | outValue | held | compensation | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Create CASH 100 × 1,000 | #1 PAYMENT 100,000 (automatic) | ORDER_CREATE −100 | 400 | 100,000 | 100,000 | 0 | 0 | 0 | 100,000 | 100,000 | 0 | OPEN |
| Return R1: 60 accepted. refundDue 60,000; owedBefore 0; cashRefund 60,000 | #2 REFUND 60,000 (RETURN_CREATE, R1) | RETURN_ACCEPTED +60 (R1) | 460 | 100,000 | 100,000 | 60,000 | 60,000 | 0 | 40,000 | 40,000 | 0 | OPEN |
| Edit R1 → R2: 50 accepted + 10 damaged, damagedRefund 4,000. State without R1: owed 0, out 100. R2 refundDue = 50 × 1,000 + 4,000 = 54,000; owedBefore 0; cashRefund 54,000 | #3 REFUND_REVERSAL 60,000 (RETURN_EDIT, R1, reverses #2); #4 REFUND 54,000 (RETURN_EDIT, R2) | RETURN_EDIT −60 (R1); RETURN_ACCEPTED +50 (R2); net −10 | 450 | 100,000 | 100,000 | 54,000 | 54,000 | 0 | 40,000 | 40,000 | 6,000 | OPEN |

R1 ends with `reversed_at` set, `reversal_kind = EDIT`, `replaced_by_return_id = R2`. Check: refundsPaid = 60,000 + 54,000 − 60,000 = 54,000; owed = 100,000 − 100,000 − 54,000 + 54,000 = 0; compensation = 10 × 1,000 − 4,000 = 6,000.

**E11 — Credit limit block and admin override (additional)**

Customer C2 with `creditLimit = 150,000` holds order #7 (LENT 120 × 1,000, nothing returned): `customerOutValue = 120,000`.

| Attempt | Caller | Body | Computation | Result |
|---|---|---|---|---|
| a | Employee | 40 × P, no override | 120,000 + 40,000 = 160,000 > 150,000; excess 10,000 | 409 `CREDIT_LIMIT_EXCEEDED` `{ creditLimit: 150000, customerOutValue: 120000, depositDelta: 40000, excess: 10000, canOverride: false }`; nothing stored (no idempotency row, no stock change) |
| b | Admin | 40 × P, no override | same | 409 `CREDIT_LIMIT_EXCEEDED` with `canOverride: true` |
| c | Admin | 40 × P, `confirmCreditOverride: true`, same Idempotency-Key as (b) | same | 201; `credit_override_by_user_id = admin`; audit `CREDIT_OVERRIDE`; customer outValue now 160,000; headroom −10,000 |
| d | Employee | Alternative to (c): 30 × P on a new order | 120,000 + 30,000 = 150,000 ≤ 150,000 | 201 (boundary is inclusive) |
| e | Employee | Line edit of the order from (c): 40 → 20 | depositDelta −20,000 ≤ 0 | 200, no credit check |
| f | Employee | Customer with `creditLimit = 0`, order of an item whose price is 0 | depositDelta 0 | 201 |

## 5. Database schema

### 5.1 Conventions

- PostgreSQL 18.6, database `pallet`, schema `public`, encoding UTF8, server and session time zone UTC.
- Prisma model = PascalCase singular; table = snake_case plural (`@@map`); Prisma field = camelCase; column = `snake_case(field)` (`@map`). The returns model is `PalletReturn` (table `returns`) because `return` is a JavaScript keyword; its lines model is `ReturnLine` (table `return_lines`).
- Primary keys: `integer` identity (`@default(autoincrement())`), except `session_families.id` and `refresh_tokens.id` (`uuid`, generated by Prisma `uuid()` client-side), `login_throttles` (composite), `user_permissions` (composite), and the singletons `factory_settings.id = 1`, `order_counter.id = 1`.
- Money: `bigint` (whole IQD). The API converts to JavaScript `number` at the repository boundary with `toSafeMoney(value: bigint): number` (throws unless `Number.isSafeInteger`). Every raw SQL `SUM()` over money or quantities is cast `::bigint`.
- Quantities: `integer`.
- Business dates: `date`. Wire format `YYYY-MM-DD`; to Prisma as `new Date('YYYY-MM-DDT00:00:00.000Z')`, from Prisma with `toISOString().slice(0, 10)` (helpers `toDbDate`/`fromDbDate` in `apps/api/src/common/dates.ts`).
- System timestamps: `timestamptz(3)` in UTC. `created_at` has DB default `now()`; `updated_at` is set by Prisma `@updatedAt` (no DB default; raw SQL inserts must supply it).
- `version integer DEFAULT 1` on every user-editable table (users, factory_settings, items, purchase_batches, customers, drivers, orders).
- Soft delete: `archived_at` + `archived_by_user_id` (items, customers, drivers); `deleted_at` + `deleted_by_user_id` (purchase_batches).
- Every foreign key column has an index (Prisma `@@index`, or covered by a leading column of a unique/composite index).
- JSON columns are `jsonb`.
- Integrity rules Prisma cannot express (CHECK constraints, partial unique index, triggers, singleton rows) live in `apps/api/prisma/sql/constraints.sql`, appended to the initial migration (section 5.9). Grants live in `apps/api/prisma/sql/grants.sql`, re-applied after every migration.

### 5.2 Tables

Notation: **Null** = `NO`/`yes`. **Default** "DB" defaults are in the database; "Prisma" defaults are applied by the client. Constraints marked CHECK are named in section 5.6.

#### `users`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| username | varchar(32) | NO | — | UNIQUE; CHECK `^[a-z0-9._-]{3,32}$`; immutable |
| display_name | varchar(100) | NO | — | CHECK not blank |
| password_hash | text | NO | — | Argon2id encoded hash; never returned, never audited |
| role | role | NO | — | `ADMIN` \| `EMPLOYEE` |
| is_active | boolean | NO | DB `true` | |
| must_change_password | boolean | NO | DB `true` | |
| token_version | integer | NO | DB `0` | CHECK ≥ 0; bumped on logout-all, deactivation, password reset/change |
| last_login_at | timestamptz(3) | yes | — | |
| version | integer | NO | DB `1` | optimistic lock |
| created_at | timestamptz(3) | NO | DB `now()` | |
| updated_at | timestamptz(3) | NO | Prisma | |

#### `user_permissions`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| user_id | integer | NO | — | PK part; FK → users.id ON DELETE CASCADE |
| permission_key | varchar(64) | NO | — | PK part; a grantable key (validated by the API) |
| created_at | timestamptz(3) | NO | DB `now()` | |

#### `session_families`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | uuid | NO | Prisma `uuid()` | PK |
| user_id | integer | NO | — | FK → users.id |
| absolute_expires_at | timestamptz(3) | NO | — | `created_at + 30 days` |
| revoked_at | timestamptz(3) | yes | — | CHECK: set iff `revoked_reason` set |
| revoked_reason | session_revoke_reason | yes | — | |
| created_ip | varchar(45) | NO | — | client IP at login |
| user_agent | varchar(255) | yes | — | truncated to 255 |
| last_used_at | timestamptz(3) | NO | DB `now()` | updated on each refresh |
| created_at | timestamptz(3) | NO | DB `now()` | |

#### `refresh_tokens`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | uuid | NO | Prisma `uuid()` | PK |
| family_id | uuid | NO | — | FK → session_families.id ON DELETE CASCADE |
| token_hash | char(64) | NO | — | UNIQUE; lowercase hex SHA-256 of the raw token; CHECK format |
| status | refresh_token_status | NO | DB `ACTIVE` | partial UNIQUE (family_id) WHERE status = 'ACTIVE' |
| expires_at | timestamptz(3) | NO | — | `min(now + 14 days, family.absolute_expires_at)` |
| rotated_at | timestamptz(3) | yes | — | CHECK: NULL when ACTIVE; set when ROTATED/RETIRED |
| created_at | timestamptz(3) | NO | DB `now()` | |

#### `login_throttles`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| ip | varchar(45) | NO | — | PK part |
| username | varchar(64) | NO | — | PK part; lowercased attempted username (may not exist) |
| failure_count | integer | NO | DB `0` | CHECK ≥ 0 |
| window_started_at | timestamptz(3) | NO | — | start of the current 15-minute window |
| locked_until | timestamptz(3) | yes | — | |
| lockout_count | integer | NO | DB `0` | CHECK ≥ 0; drives the exponential back-off |
| updated_at | timestamptz(3) | NO | Prisma | rows idle > 24 h are deleted hourly |

#### `factory_settings` (singleton)
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | DB `1` | PK; CHECK `id = 1` |
| factory_name | varchar(200) | NO | — | shown on the receipt |
| phone | varchar(100) | NO | — | free text (may hold two numbers) |
| address | varchar(300) | NO | — | |
| logo_upload_id | integer | yes | — | FK → uploads.id ON DELETE RESTRICT; upload kind must be `FACTORY_LOGO` |
| version | integer | NO | DB `1` | |
| updated_at | timestamptz(3) | NO | Prisma | |
| updated_by_user_id | integer | yes | — | FK → users.id ON DELETE RESTRICT |

The row is inserted by the first-run seed (default values are listed with the first-run seed in section 13).

#### `uploads`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| file_name | varchar(64) | NO | — | UNIQUE; CHECK `^[0-9a-f]{32}\.webp$` (16 random bytes hex) |
| kind | upload_kind | NO | — | `ITEM_IMAGE` \| `FACTORY_LOGO` |
| width | integer | NO | — | CHECK > 0 (after re-encode) |
| height | integer | NO | — | CHECK > 0 |
| size_bytes | integer | NO | — | CHECK > 0 (WebP size on disk) |
| created_by_user_id | integer | NO | — | FK → users.id |
| created_at | timestamptz(3) | NO | DB `now()` | |

#### `items`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| name | varchar(200) | NO | — | CHECK not blank; not unique |
| image_upload_id | integer | yes | — | FK → uploads.id ON DELETE RESTRICT; kind `ITEM_IMAGE` |
| deposit_price | bigint | NO | — | CHECK ≥ 0; never changed by batches |
| quantity_on_hand | integer | NO | DB `0` | CHECK ≥ 0; maintained by `StockLedger.apply` only |
| min_stock | integer | yes | — | CHECK NULL or ≥ 0 |
| archived_at | timestamptz(3) | yes | — | CHECK: set iff archived_by_user_id set |
| archived_by_user_id | integer | yes | — | FK → users.id ON DELETE RESTRICT |
| version | integer | NO | DB `1` | not bumped by stock movements |
| created_at | timestamptz(3) | NO | DB `now()` | |
| updated_at | timestamptz(3) | NO | Prisma | |
| created_by_user_id | integer | NO | — | FK → users.id |

#### `purchase_batches`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| item_id | integer | NO | — | FK → items.id; immutable |
| date | date | NO | — | business date ≤ today |
| quantity | integer | NO | — | CHECK > 0 |
| unit_cost | bigint | NO | — | CHECK ≥ 0; **sensitive** (items.viewCost) |
| total_cost | bigint | NO | — | CHECK = quantity × unit_cost; **sensitive** |
| note | varchar(500) | yes | — | |
| deleted_at | timestamptz(3) | yes | — | soft delete |
| deleted_by_user_id | integer | yes | — | FK → users.id ON DELETE RESTRICT; CHECK set iff deleted_at set |
| version | integer | NO | DB `1` | |
| created_at | timestamptz(3) | NO | DB `now()` | |
| updated_at | timestamptz(3) | NO | Prisma | |
| created_by_user_id | integer | NO | — | FK → users.id |

#### `stock_movements` (append-only)
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| item_id | integer | NO | — | FK → items.id |
| quantity | integer | NO | — | CHECK ≠ 0; sign per reason (section 4.7.1) |
| reason | stock_movement_reason | NO | — | |
| batch_id | integer | yes | — | FK → purchase_batches.id; required for BATCH_* |
| order_id | integer | yes | — | FK → orders.id; required for ORDER_* and RETURN_* |
| return_id | integer | yes | — | FK → returns.id; required for RETURN_* |
| note | varchar(500) | yes | — | required for MANUAL_ADJUSTMENT |
| created_by_user_id | integer | NO | — | FK → users.id |
| created_at | timestamptz(3) | NO | DB `now()` | |

#### `customers`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| name | varchar(200) | NO | — | CHECK not blank |
| phone | varchar(20) | NO | — | normalised; CHECK `^\+?[0-9]{7,15}$`; indexed |
| alt_phone | varchar(20) | yes | — | same format; indexed |
| address | varchar(300) | NO | — | |
| credit_limit | bigint | yes | — | NULL = no limit; CHECK NULL or ≥ 0 |
| archived_at | timestamptz(3) | yes | — | |
| archived_by_user_id | integer | yes | — | FK → users.id ON DELETE RESTRICT |
| version | integer | NO | DB `1` | |
| created_at | timestamptz(3) | NO | DB `now()` | |
| updated_at | timestamptz(3) | NO | Prisma | |
| created_by_user_id | integer | NO | — | FK → users.id |

#### `drivers`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| name | varchar(200) | NO | — | CHECK not blank |
| phone | varchar(20) | NO | — | normalised; CHECK `^\+?[0-9]{7,15}$` |
| car_number | varchar(50) | NO | — | CHECK not blank; free text (plate format varies) |
| archived_at | timestamptz(3) | yes | — | |
| archived_by_user_id | integer | yes | — | FK → users.id ON DELETE RESTRICT |
| version | integer | NO | DB `1` | |
| created_at | timestamptz(3) | NO | DB `now()` | |
| updated_at | timestamptz(3) | NO | Prisma | |
| created_by_user_id | integer | NO | — | FK → users.id |

#### `order_counter` (singleton)
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | DB `1` | PK; CHECK `id = 1`; row inserted by constraints.sql |
| last_number | integer | NO | DB `0` | CHECK ≥ 0; locked FOR UPDATE on allocation |

#### `orders`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| order_number | integer | NO | — | UNIQUE; CHECK ≥ 1; gap-free |
| customer_id | integer | NO | — | FK → customers.id; immutable |
| driver_id | integer | NO | — | FK → drivers.id |
| date | date | NO | — | business date |
| payment_type | payment_type | NO | — | `CASH` \| `LENT`; immutable |
| notes | varchar(1000) | yes | — | |
| status | order_status | NO | DB `OPEN` | cache (recomputeOrder) |
| deposit_total | bigint | NO | DB `0` | cache |
| payments_net | bigint | NO | DB `0` | cache (`payments`) |
| credits_total | bigint | NO | DB `0` | cache (`credits`) |
| refunds_net | bigint | NO | DB `0` | cache (`refundsPaid`) |
| owed | bigint | NO | DB `0` | cache |
| out_quantity_total | integer | NO | DB `0` | cache |
| out_value | bigint | NO | DB `0` | cache |
| held | bigint | NO | DB `0` | cache |
| compensation | bigint | NO | DB `0` | cache |
| cancelled_at | timestamptz(3) | yes | — | CHECK: set iff cancelled_by_user_id set iff status = CANCELLED |
| cancelled_by_user_id | integer | yes | — | FK → users.id ON DELETE RESTRICT |
| credit_override_by_user_id | integer | yes | — | FK → users.id ON DELETE RESTRICT; CHECK set iff credit_override_at set |
| credit_override_at | timestamptz(3) | yes | — | |
| version | integer | NO | DB `1` | |
| created_at | timestamptz(3) | NO | DB `now()` | |
| updated_at | timestamptz(3) | NO | Prisma | |
| created_by_user_id | integer | NO | — | FK → users.id |

CHECK `orders_totals_nonnegative_check`: every cache money/quantity column ≥ 0.

#### `order_lines`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| order_id | integer | NO | — | FK → orders.id; UNIQUE (order_id, item_id) |
| item_id | integer | NO | — | FK → items.id |
| quantity | integer | NO | — | CHECK > 0 |
| unit_deposit | bigint | NO | — | CHECK ≥ 0; frozen at creation (Q15 for edits) |
| line_total | bigint | NO | — | CHECK = quantity × unit_deposit |
| returned_accepted | integer | NO | DB `0` | cache |
| returned_damaged | integer | NO | DB `0` | cache |
| out_quantity | integer | NO | — | cache; CHECK = quantity − returned_accepted − returned_damaged, or 0 with nothing returned on a cancelled order (Q39); ≥ 0 |
| created_at | timestamptz(3) | NO | DB `now()` | |
| updated_at | timestamptz(3) | NO | Prisma | |

#### `returns`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| order_id | integer | NO | — | FK → orders.id |
| date | date | NO | — | business date, ≥ order date, ≤ today |
| notes | varchar(1000) | yes | — | |
| refund_due | bigint | NO | — | CHECK ≥ 0; immutable |
| owed_before | bigint | NO | — | CHECK ≥ 0; immutable |
| cash_refund | bigint | NO | — | CHECK = GREATEST(0, refund_due − owed_before); immutable |
| reversed_at | timestamptz(3) | yes | — | set once (trigger); CHECK consistent with reversed_by_user_id and reversal_kind |
| reversed_by_user_id | integer | yes | — | FK → users.id ON DELETE RESTRICT |
| reversal_kind | return_reversal_kind | yes | — | `EDIT` \| `DELETE` |
| replaced_by_return_id | integer | yes | — | UNIQUE; FK → returns.id ON DELETE RESTRICT; required iff reversal_kind = EDIT |
| created_at | timestamptz(3) | NO | DB `now()` | |
| created_by_user_id | integer | NO | — | FK → users.id |

#### `return_lines` (append-only)
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| return_id | integer | NO | — | FK → returns.id; UNIQUE (return_id, order_line_id) |
| order_line_id | integer | NO | — | FK → order_lines.id |
| accepted_quantity | integer | NO | — | CHECK ≥ 0 |
| damaged_quantity | integer | NO | — | CHECK ≥ 0; CHECK accepted + damaged > 0 |
| unit_deposit | bigint | NO | — | copy of the order line's unit_deposit; CHECK ≥ 0 |
| damaged_refund | bigint | NO | — | CHECK 0 ≤ damaged_refund ≤ damaged_quantity × unit_deposit |
| created_at | timestamptz(3) | NO | DB `now()` | |

#### `ledger_entries` (append-only money ledger)
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| order_id | integer | NO | — | FK → orders.id |
| type | ledger_entry_type | NO | — | |
| source | ledger_entry_source | NO | — | CHECK per type (section 4.7.2) |
| amount | bigint | NO | — | CHECK > 0 |
| date | date | yes | — | NULL iff automatic PAYMENT (effective date = order date) |
| is_automatic | boolean | NO | DB `false` | only on PAYMENT |
| return_id | integer | yes | — | FK → returns.id; required iff type ∈ {REFUND, REFUND_REVERSAL} |
| reverses_entry_id | integer | yes | — | UNIQUE; FK → ledger_entries.id; required iff type is a reversal; trigger checks mirror |
| note | varchar(500) | yes | — | |
| created_at | timestamptz(3) | NO | DB `now()` | defines insertion order |
| created_by_user_id | integer | NO | — | FK → users.id |

#### `idempotency_keys`
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| user_id | integer | NO | — | FK → users.id; UNIQUE (user_id, key) |
| key | varchar(100) | NO | — | CHECK `^[A-Za-z0-9_-]{16,100}$` |
| scope | idempotency_scope | NO | — | `ORDER_CREATE` \| `RETURN_CREATE` \| `PAYMENT_CREATE` |
| request_hash | char(64) | NO | — | SHA-256 hex of the canonical request (section 6, idempotency) |
| response_status | integer | NO | — | 201 |
| response_body | jsonb | NO | — | stored response, replayed verbatim |
| created_at | timestamptz(3) | NO | DB `now()` | |
| expires_at | timestamptz(3) | NO | — | `created_at + 24 h`; CHECK > created_at; hourly purge |

#### `audit_logs` (append-only)
| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| id | integer | NO | identity | PK |
| created_at | timestamptz(3) | NO | DB `now()` | |
| user_id | integer | yes | — | FK → users.id ON DELETE RESTRICT; NULL for failed logins of unknown usernames |
| username_attempt | varchar(64) | yes | — | lowercased username on LOGIN_FAILURE/LOCKOUT |
| action | audit_action | NO | — | |
| entity_type | audit_entity_type | NO | — | |
| entity_id | varchar(64) | yes | — | id as string (uuid for SESSION, `1` for SETTINGS) |
| summary_key | varchar(100) | NO | — | i18n key `audit.summary.<ENTITY_TYPE>.<ACTION>` |
| summary_params | jsonb | NO | DB `'{}'` | never contains cost values |
| ip | varchar(45) | yes | — | client IP (`req.ip`) |
| request_id | varchar(64) | yes | — | correlates with logs |
| before | jsonb | yes | — | redacted snapshot (section 11) |
| after | jsonb | yes | — | redacted snapshot |

### 5.3 Enums (PostgreSQL enum types)

| Type | Values |
|---|---|
| `role` | ADMIN, EMPLOYEE |
| `payment_type` | CASH, LENT |
| `order_status` | OPEN, SETTLED, CANCELLED |
| `stock_movement_reason` | BATCH_ADD, BATCH_EDIT, BATCH_DELETE, ORDER_CREATE, ORDER_LINE_EDIT, ORDER_CANCEL, RETURN_ACCEPTED, RETURN_EDIT, RETURN_DELETE, MANUAL_ADJUSTMENT |
| `ledger_entry_type` | PAYMENT, REFUND, PAYMENT_REVERSAL, REFUND_REVERSAL |
| `ledger_entry_source` | ORDER_CREATE, ORDER_LINE_EDIT, ORDER_CANCEL, MANUAL, PAYMENT_DELETE, RETURN_CREATE, RETURN_EDIT, RETURN_DELETE |
| `return_reversal_kind` | EDIT, DELETE |
| `upload_kind` | ITEM_IMAGE, FACTORY_LOGO |
| `refresh_token_status` | ACTIVE, ROTATED, RETIRED, REVOKED |
| `session_revoke_reason` | LOGOUT, LOGOUT_ALL, REUSE_DETECTED, PASSWORD_CHANGED, PASSWORD_RESET, USER_DEACTIVATED |
| `idempotency_scope` | ORDER_CREATE, RETURN_CREATE, PAYMENT_CREATE |
| `audit_action` | CREATE, UPDATE, DELETE, CANCEL, STOCK_ADJUST, PAYMENT_CREATE, PAYMENT_REVERSE, RETURN_CREATE, RETURN_EDIT, RETURN_DELETE, REFUND_CREATE, REFUND_REVERSE, CREDIT_OVERRIDE, LOGIN_SUCCESS, LOGIN_FAILURE, LOCKOUT, LOGOUT, LOGOUT_ALL, SESSION_REUSE_DETECTED, PASSWORD_CHANGE, PASSWORD_RESET, PERMISSION_CHANGE, SETTINGS_CHANGE, USER_DEACTIVATE, USER_ACTIVATE, UPLOAD_CREATE |
| `audit_entity_type` | USER, SESSION, ITEM, PURCHASE_BATCH, CUSTOMER, DRIVER, ORDER, RETURN, LEDGER_ENTRY, SETTINGS, UPLOAD |

The same values are exported from `packages/shared/src/enums.ts`; a unit test parses `schema.prisma` and asserts equality.

### 5.4 Indexes

Unique: `users_username_key (username)`, `refresh_tokens_token_hash_key (token_hash)`, `refresh_tokens_one_active_per_family (family_id) WHERE status = 'ACTIVE'` (partial, constraints.sql), `uploads_file_name_key (file_name)`, `orders_order_number_key (order_number)`, `order_lines_order_id_item_id_key (order_id, item_id)`, `returns_replaced_by_return_id_key (replaced_by_return_id)`, `return_lines_return_id_order_line_id_key (return_id, order_line_id)`, `ledger_entries_reverses_entry_id_key (reverses_entry_id)`, `idempotency_keys_user_id_key_key (user_id, key)`. Primary keys: `user_permissions (user_id, permission_key)`, `login_throttles (ip, username)`.

Non-unique:

| Table | Index | Columns | Purpose |
|---|---|---|---|
| users | users_role_is_active_idx | role, is_active | last-admin guard |
| session_families | session_families_user_id_revoked_at_idx | user_id, revoked_at | revoke all of a user |
| refresh_tokens | refresh_tokens_family_id_status_idx | family_id, status | head / previous lookup |
| login_throttles | login_throttles_username_idx | username | unlock runbook |
| factory_settings | factory_settings_logo_upload_id_idx, factory_settings_updated_by_user_id_idx | FK | FK |
| uploads | uploads_created_by_user_id_idx | created_by_user_id | FK |
| items | items_image_upload_id_idx, items_archived_at_idx, items_archived_by_user_id_idx, items_created_by_user_id_idx | FK / filter | |
| purchase_batches | purchase_batches_item_id_date_idx | item_id, date | batches per item newest first |
| purchase_batches | purchase_batches_date_idx | date | purchases report |
| purchase_batches | purchase_batches_deleted_by_user_id_idx, purchase_batches_created_by_user_id_idx | FK | |
| stock_movements | stock_movements_item_id_created_at_idx | item_id, created_at | item history, R1 |
| stock_movements | stock_movements_batch_id_idx, stock_movements_order_id_idx, stock_movements_return_id_idx, stock_movements_created_by_user_id_idx | FK | |
| customers | customers_phone_idx, customers_alt_phone_idx | phone / alt_phone | duplicate check |
| customers | customers_archived_at_idx, customers_archived_by_user_id_idx, customers_created_by_user_id_idx | filter / FK | |
| drivers | drivers_archived_at_idx, drivers_archived_by_user_id_idx, drivers_created_by_user_id_idx | filter / FK | |
| orders | orders_customer_id_status_idx | customer_id, status | customer aggregates, credit check |
| orders | orders_driver_id_idx | driver_id | activity filter |
| orders | orders_date_idx | date | activity report |
| orders | orders_status_date_idx | status, date | default OPEN list |
| orders | orders_cancelled_by_user_id_idx, orders_credit_override_by_user_id_idx, orders_created_by_user_id_idx | FK | |
| order_lines | order_lines_item_id_idx | item_id | item out quantity |
| returns | returns_order_id_idx, returns_date_idx, returns_reversed_by_user_id_idx, returns_created_by_user_id_idx | FK / report | |
| return_lines | return_lines_order_line_id_idx | order_line_id | FK |
| ledger_entries | ledger_entries_order_id_idx | order_id | per-order ledger |
| ledger_entries | ledger_entries_type_date_idx, ledger_entries_date_idx | type, date / date | activity report |
| ledger_entries | ledger_entries_return_id_idx, ledger_entries_created_by_user_id_idx | FK | |
| idempotency_keys | idempotency_keys_expires_at_idx | expires_at | purge |
| audit_logs | audit_logs_created_at_idx, audit_logs_user_id_created_at_idx, audit_logs_entity_type_entity_id_idx, audit_logs_action_created_at_idx | filters | history page |

### 5.5 Foreign keys

All foreign keys reference `id` and use `ON UPDATE CASCADE` (primary keys are never updated). `ON DELETE` behaviour as generated from the Prisma schema:

| Table.column | References | ON DELETE |
|---|---|---|
| user_permissions.user_id | users | CASCADE |
| refresh_tokens.family_id | session_families | CASCADE |
| session_families.user_id, uploads.created_by_user_id, items.created_by_user_id, purchase_batches.created_by_user_id, stock_movements.created_by_user_id, customers.created_by_user_id, drivers.created_by_user_id, orders.created_by_user_id, returns.created_by_user_id, ledger_entries.created_by_user_id, idempotency_keys.user_id | users | RESTRICT |
| factory_settings.updated_by_user_id, items.archived_by_user_id, purchase_batches.deleted_by_user_id, customers.archived_by_user_id, drivers.archived_by_user_id, orders.cancelled_by_user_id, orders.credit_override_by_user_id, returns.reversed_by_user_id, audit_logs.user_id | users | RESTRICT |
| factory_settings.logo_upload_id, items.image_upload_id | uploads | RESTRICT |
| purchase_batches.item_id, stock_movements.item_id, order_lines.item_id | items | RESTRICT |
| orders.customer_id | customers | RESTRICT |
| orders.driver_id | drivers | RESTRICT |
| order_lines.order_id, returns.order_id, ledger_entries.order_id | orders | RESTRICT |
| return_lines.return_id | returns | RESTRICT |
| return_lines.order_line_id | order_lines | RESTRICT |
| stock_movements.batch_id | purchase_batches | RESTRICT |
| stock_movements.order_id | orders | RESTRICT |
| stock_movements.return_id, ledger_entries.return_id, returns.replaced_by_return_id | returns | RESTRICT |
| ledger_entries.reverses_entry_id | ledger_entries | RESTRICT |

There is no `ON DELETE SET NULL`: every optional relation is `onDelete: Restrict` in the Prisma schema, so deleting a referenced row fails. Users, uploads, batches, orders and returns are never deleted by the application (users are deactivated, batches soft-deleted), and any cascaded UPDATE of an append-only row would be rejected by `forbid_update_delete`. The only physical deletes the application performs are: `user_permissions` rows (permission edits), `order_lines` rows removed by a line edit (only while the order has no returns, so nothing references them), `login_throttles`, expired `idempotency_keys`, and `session_families` (with their `refresh_tokens`, by cascade) deleted by the daily maintenance job 30 days after the family's `absolute_expires_at`.

### 5.6 CHECK constraints (defined in constraints.sql)

| Table | Constraint | Rule |
|---|---|---|
| users | users_username_format_check | username ~ `^[a-z0-9._-]{3,32}$` |
| users | users_display_name_not_blank_check, users_token_version_nonnegative_check, users_version_positive_check | btrim ≠ ''; ≥ 0; ≥ 1 |
| session_families | session_families_revocation_consistent_check | revoked_at set iff revoked_reason set |
| refresh_tokens | refresh_tokens_token_hash_format_check | 64 lowercase hex |
| refresh_tokens | refresh_tokens_rotated_at_consistent_check | ACTIVE ⇒ rotated_at NULL; ROTATED/RETIRED ⇒ rotated_at set |
| login_throttles | login_throttles_failure_count_nonnegative_check, login_throttles_lockout_count_nonnegative_check | ≥ 0 |
| factory_settings | factory_settings_singleton_check, factory_settings_version_positive_check | id = 1; version ≥ 1 |
| uploads | uploads_file_name_format_check, uploads_dimensions_positive_check, uploads_size_bytes_positive_check | `^[0-9a-f]{32}\.webp$`; > 0; > 0 |
| items | items_name_not_blank_check, items_deposit_price_nonnegative_check, items_quantity_on_hand_nonnegative_check, items_min_stock_nonnegative_check, items_archive_consistent_check, items_version_positive_check | as named |
| purchase_batches | purchase_batches_quantity_positive_check, purchase_batches_unit_cost_nonnegative_check, purchase_batches_total_cost_matches_check, purchase_batches_delete_consistent_check, purchase_batches_version_positive_check | quantity > 0; unit_cost ≥ 0; total_cost = quantity × unit_cost |
| stock_movements | stock_movements_quantity_nonzero_check | quantity ≠ 0 |
| stock_movements | stock_movements_reference_matches_reason_check | BATCH_* ⇒ only batch_id; ORDER_* ⇒ only order_id; RETURN_* ⇒ return_id and order_id; MANUAL_ADJUSTMENT ⇒ note, no references |
| stock_movements | stock_movements_quantity_sign_check | + for BATCH_ADD, ORDER_CANCEL, RETURN_ACCEPTED; − for BATCH_DELETE, ORDER_CREATE, RETURN_EDIT, RETURN_DELETE; ± otherwise |
| customers | customers_name_not_blank_check, customers_phone_format_check, customers_alt_phone_format_check, customers_credit_limit_nonnegative_check, customers_archive_consistent_check, customers_version_positive_check | as named |
| drivers | drivers_name_not_blank_check, drivers_phone_format_check, drivers_car_number_not_blank_check, drivers_archive_consistent_check, drivers_version_positive_check | as named |
| order_counter | order_counter_singleton_check, order_counter_last_number_nonnegative_check | id = 1; ≥ 0 |
| orders | orders_order_number_positive_check, orders_totals_nonnegative_check, orders_cancel_consistent_check, orders_credit_override_consistent_check, orders_version_positive_check | as named |
| order_lines | order_lines_quantity_positive_check, order_lines_unit_deposit_nonnegative_check, order_lines_line_total_matches_check, order_lines_returned_nonnegative_check, order_lines_out_quantity_matches_check, order_lines_out_quantity_nonnegative_check | as named |
| returns | returns_money_nonnegative_check, returns_cash_refund_formula_check, returns_reversal_consistent_check, returns_replacement_matches_kind_check, returns_not_self_replaced_check | cash_refund = GREATEST(0, refund_due − owed_before); EDIT ⇔ replaced_by set |
| return_lines | return_lines_quantities_nonnegative_check, return_lines_quantity_positive_check, return_lines_unit_deposit_nonnegative_check, return_lines_damaged_refund_range_check | as named |
| ledger_entries | ledger_entries_amount_positive_check, ledger_entries_reversal_reference_check, ledger_entries_not_self_reversal_check, ledger_entries_automatic_only_payment_check, ledger_entries_date_null_only_automatic_check, ledger_entries_return_reference_check, ledger_entries_source_matches_type_check | section 4.7.2 |
| idempotency_keys | idempotency_keys_key_format_check, idempotency_keys_request_hash_format_check, idempotency_keys_expiry_after_creation_check | as named |

The API maps a PostgreSQL `check_violation` (23514) that escapes service validation to 500 `INTERNAL_ERROR` and logs the constraint name: a CHECK firing in production means a service bug, never a user error.

### 5.7 Database roles and privileges

| Role | Created by | Login | Purpose |
|---|---|---|---|
| `postgres` | postgres image (`POSTGRES_PASSWORD`) | yes (local socket inside the container only) | Superuser. Used only by the init script and emergency runbooks. |
| `pallet_owner` | `deploy/postgres/init/01-roles.sh` (`DB_OWNER_PASSWORD`) | yes | Owns database `pallet` and schema `public`; `CREATEDB` (Prisma shadow database in development). Runs migrations, grants, seeds, backups (`pg_dump`) and the reconciliation command. URL: `DATABASE_MIGRATE_URL`. |
| `pallet_app` | init script (`DB_APP_PASSWORD`) | yes | Runtime role of the API. URL: `DATABASE_URL`. Session defaults: `statement_timeout = 30s`, `idle_in_transaction_session_timeout = 60s`, `timezone = UTC`. |

Privilege matrix for `pallet_app` (applied by `grants.sql`; no TRUNCATE, REFERENCES, TRIGGER or DDL anywhere; nothing on `_prisma_migrations`):

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| users, user_permissions, session_families, refresh_tokens, login_throttles, factory_settings, uploads, items, purchase_batches, customers, drivers, order_counter, orders, order_lines, idempotency_keys | ✔ | ✔ | ✔ | ✔ |
| audit_logs, stock_movements, ledger_entries, return_lines | ✔ | ✔ | — | — |
| returns | ✔ | ✔ | only columns reversed_at, reversed_by_user_id, reversal_kind, replaced_by_return_id | — |
| all sequences | USAGE, SELECT | | | |

Additional database-level settings from the init script: `REVOKE ALL ON DATABASE pallet FROM PUBLIC`, `GRANT CONNECT ON DATABASE pallet TO pallet_app`, `REVOKE ALL ON SCHEMA public FROM PUBLIC`, `GRANT USAGE ON SCHEMA public TO pallet_app`. The integration suite connects as `pallet_app` and asserts `UPDATE`/`DELETE` on `audit_logs`, `stock_movements`, `ledger_entries`, `return_lines` and `DELETE` on `returns` fail with SQLSTATE `42501`, and that `pallet_app` holds at least SELECT on every table in `public` except `_prisma_migrations` (catches a table missing from `grants.sql`).

### 5.8 Triggers

| Trigger | Table | Timing | Function | Behaviour |
|---|---|---|---|---|
| forbid_update_delete | audit_logs, stock_movements, ledger_entries, return_lines | BEFORE UPDATE OR DELETE, per row | `forbid_update_delete()` | Raises `insufficient_privilege` for every role (defence in depth; row triggers do not fire on TRUNCATE, so the test reset and `pg_restore` are unaffected). |
| forbid_delete | returns | BEFORE DELETE, per row | `forbid_update_delete()` | Returns are never deleted. |
| returns_reversal_set_once | returns | BEFORE UPDATE, per row | `returns_reversal_set_once()` | Rejects if the row is already reversed, if `reversed_at` stays NULL, or if any non-reversal column changes. The reversal UPDATE must therefore set all reversal columns in one statement (section 4.8.5 step 5e). |
| ledger_reversal_matches_original | ledger_entries | BEFORE INSERT, per row | `ledger_reversal_matches_original()` | A reversal row must reference an existing row of the same order with the same amount and the matching original type. |

### 5.9 Migrations

1. Schema changes are made in `apps/api/prisma/schema.prisma` and turned into SQL with `pnpm --filter @pallet/api exec prisma migrate dev --create-only --name <snake_case_name>` (development database, as `pallet_owner`).
2. The initial migration `apps/api/prisma/migrations/<timestamp>_init/migration.sql` = the Prisma-generated DDL followed verbatim by `apps/api/prisma/sql/constraints.sql`. Later migrations that add CHECKs or triggers append hand-written SQL to their own `migration.sql` the same way and update `constraints.sql` so it stays the complete reference.
3. Production: the `migrate` compose service runs `prisma migrate deploy` as `pallet_owner`, then `prisma db execute --file prisma/sql/grants.sql`, then the first-run seed (idempotent). The API never runs migrations.
4. Grants are re-applied after every migration in every environment, because a new table starts with no privileges for `pallet_app`: `pnpm db:migrate` (development) and `pnpm db:deploy` (CI) both end with `prisma db execute --file prisma/sql/grants.sql`.
5. Migrations are forward-only. A change that cannot be rolled back by redeploying the previous image (column drops, type narrowing) is split into expand (release N) and contract (release N+1) so that release N−1 can still run against the schema of release N.
6. A new table requires: model in `schema.prisma`, grants entry in `grants.sql`, redaction entry in section 11, and (for append-only tables) a `forbid_update_delete` trigger.

### 5.10 Prisma schema (`apps/api/prisma/schema.prisma`, verbatim)

```prisma
// Pallet System — Prisma schema (source of truth for the database).
// Naming rule: Prisma model = PascalCase singular; table = snake_case plural (@@map);
// Prisma field = camelCase; column = snake_case of the field name (@map).
// Money = BigInt (PostgreSQL bigint, whole IQD). Quantities = Int.
// Business dates = @db.Date (Asia/Baghdad calendar day). System timestamps = @db.Timestamptz(3) in UTC.
// CHECK constraints, partial indexes, triggers and grants live in raw SQL inside the migrations
// (see ARCHITECTURE.md sections 5.6–5.9) because Prisma cannot express them.
// Every optional relation is onDelete: Restrict (nothing referenced is ever deleted).

generator client {
  provider     = "prisma-client"
  output       = "../src/generated/prisma"
  moduleFormat = "cjs"
  runtime      = "nodejs"
}

datasource db {
  provider = "postgresql"
}

// ───────────────────────────── Enums ─────────────────────────────

enum Role {
  ADMIN
  EMPLOYEE

  @@map("role")
}

enum PaymentType {
  CASH
  LENT

  @@map("payment_type")
}

enum OrderStatus {
  OPEN
  SETTLED
  CANCELLED

  @@map("order_status")
}

enum StockMovementReason {
  BATCH_ADD
  BATCH_EDIT
  BATCH_DELETE
  ORDER_CREATE
  ORDER_LINE_EDIT
  ORDER_CANCEL
  RETURN_ACCEPTED
  RETURN_EDIT
  RETURN_DELETE
  MANUAL_ADJUSTMENT

  @@map("stock_movement_reason")
}

enum LedgerEntryType {
  PAYMENT
  REFUND
  PAYMENT_REVERSAL
  REFUND_REVERSAL

  @@map("ledger_entry_type")
}

enum LedgerEntrySource {
  ORDER_CREATE
  ORDER_LINE_EDIT
  ORDER_CANCEL
  MANUAL
  PAYMENT_DELETE
  RETURN_CREATE
  RETURN_EDIT
  RETURN_DELETE

  @@map("ledger_entry_source")
}

enum ReturnReversalKind {
  EDIT
  DELETE

  @@map("return_reversal_kind")
}

enum UploadKind {
  ITEM_IMAGE
  FACTORY_LOGO

  @@map("upload_kind")
}

enum RefreshTokenStatus {
  ACTIVE
  ROTATED
  RETIRED
  REVOKED

  @@map("refresh_token_status")
}

enum SessionRevokeReason {
  LOGOUT
  LOGOUT_ALL
  REUSE_DETECTED
  PASSWORD_CHANGED
  PASSWORD_RESET
  USER_DEACTIVATED

  @@map("session_revoke_reason")
}

enum IdempotencyScope {
  ORDER_CREATE
  RETURN_CREATE
  PAYMENT_CREATE

  @@map("idempotency_scope")
}

enum AuditAction {
  CREATE
  UPDATE
  DELETE
  CANCEL
  STOCK_ADJUST
  PAYMENT_CREATE
  PAYMENT_REVERSE
  RETURN_CREATE
  RETURN_EDIT
  RETURN_DELETE
  REFUND_CREATE
  REFUND_REVERSE
  CREDIT_OVERRIDE
  LOGIN_SUCCESS
  LOGIN_FAILURE
  LOCKOUT
  LOGOUT
  LOGOUT_ALL
  SESSION_REUSE_DETECTED
  PASSWORD_CHANGE
  PASSWORD_RESET
  PERMISSION_CHANGE
  SETTINGS_CHANGE
  USER_DEACTIVATE
  USER_ACTIVATE
  UPLOAD_CREATE

  @@map("audit_action")
}

enum AuditEntityType {
  USER
  SESSION
  ITEM
  PURCHASE_BATCH
  CUSTOMER
  DRIVER
  ORDER
  RETURN
  LEDGER_ENTRY
  SETTINGS
  UPLOAD

  @@map("audit_entity_type")
}

// ───────────────────────────── Users & auth ─────────────────────────────

model User {
  id                 Int       @id @default(autoincrement())
  username           String    @unique @db.VarChar(32)
  displayName        String    @map("display_name") @db.VarChar(100)
  passwordHash       String    @map("password_hash") @db.Text
  role               Role
  isActive           Boolean   @default(true) @map("is_active")
  mustChangePassword Boolean   @default(true) @map("must_change_password")
  tokenVersion       Int       @default(0) @map("token_version")
  lastLoginAt        DateTime? @map("last_login_at") @db.Timestamptz(3)
  version            Int       @default(1)
  createdAt          DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt          DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  permissions     UserPermission[]
  sessionFamilies SessionFamily[]
  idempotencyKeys IdempotencyKey[]
  auditLogs       AuditLog[]

  uploadsCreated         Upload[]          @relation("UploadCreatedBy")
  settingsUpdated        FactorySettings[] @relation("SettingsUpdatedBy")
  itemsCreated           Item[]            @relation("ItemCreatedBy")
  itemsArchived          Item[]            @relation("ItemArchivedBy")
  batchesCreated         PurchaseBatch[]   @relation("BatchCreatedBy")
  batchesDeleted         PurchaseBatch[]   @relation("BatchDeletedBy")
  stockMovementsCreated  StockMovement[]   @relation("StockMovementCreatedBy")
  customersCreated       Customer[]        @relation("CustomerCreatedBy")
  customersArchived      Customer[]        @relation("CustomerArchivedBy")
  driversCreated         Driver[]          @relation("DriverCreatedBy")
  driversArchived        Driver[]          @relation("DriverArchivedBy")
  ordersCreated          Order[]           @relation("OrderCreatedBy")
  ordersCancelled        Order[]           @relation("OrderCancelledBy")
  ordersCreditOverridden Order[]           @relation("OrderCreditOverrideBy")
  returnsCreated         PalletReturn[]    @relation("ReturnCreatedBy")
  returnsReversed        PalletReturn[]    @relation("ReturnReversedBy")
  ledgerEntriesCreated   LedgerEntry[]     @relation("LedgerEntryCreatedBy")

  @@index([role, isActive])
  @@map("users")
}

model UserPermission {
  userId        Int      @map("user_id")
  permissionKey String   @map("permission_key") @db.VarChar(64)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, permissionKey])
  @@map("user_permissions")
}

// One login session (one browser) = one family of rotating refresh tokens.
model SessionFamily {
  id                String               @id @default(uuid()) @db.Uuid
  userId            Int                  @map("user_id")
  absoluteExpiresAt DateTime             @map("absolute_expires_at") @db.Timestamptz(3)
  revokedAt         DateTime?            @map("revoked_at") @db.Timestamptz(3)
  revokedReason     SessionRevokeReason? @map("revoked_reason")
  createdIp         String               @map("created_ip") @db.VarChar(45)
  userAgent         String?              @map("user_agent") @db.VarChar(255)
  lastUsedAt        DateTime             @default(now()) @map("last_used_at") @db.Timestamptz(3)
  createdAt         DateTime             @default(now()) @map("created_at") @db.Timestamptz(3)

  user   User           @relation(fields: [userId], references: [id])
  tokens RefreshToken[]

  @@index([userId, revokedAt])
  @@map("session_families")
}

model RefreshToken {
  id        String             @id @default(uuid()) @db.Uuid
  familyId  String             @map("family_id") @db.Uuid
  tokenHash String             @unique @map("token_hash") @db.Char(64)
  status    RefreshTokenStatus @default(ACTIVE)
  expiresAt DateTime           @map("expires_at") @db.Timestamptz(3)
  rotatedAt DateTime?          @map("rotated_at") @db.Timestamptz(3)
  createdAt DateTime           @default(now()) @map("created_at") @db.Timestamptz(3)

  family SessionFamily @relation(fields: [familyId], references: [id], onDelete: Cascade)

  @@index([familyId, status])
  @@map("refresh_tokens")
}

model LoginThrottle {
  ip              String    @db.VarChar(45)
  username        String    @db.VarChar(64)
  failureCount    Int       @default(0) @map("failure_count")
  windowStartedAt DateTime  @map("window_started_at") @db.Timestamptz(3)
  lockedUntil     DateTime? @map("locked_until") @db.Timestamptz(3)
  lockoutCount    Int       @default(0) @map("lockout_count")
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@id([ip, username])
  @@index([username])
  @@map("login_throttles")
}

// ───────────────────────────── Settings & uploads ─────────────────────────────

model FactorySettings {
  id              Int      @id @default(1)
  factoryName     String   @map("factory_name") @db.VarChar(200)
  phone           String   @db.VarChar(100)
  address         String   @db.VarChar(300)
  logoUploadId    Int?     @map("logo_upload_id")
  version         Int      @default(1)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedByUserId Int?     @map("updated_by_user_id")

  logo      Upload? @relation("SettingsLogo", fields: [logoUploadId], references: [id], onDelete: Restrict)
  updatedBy User?   @relation("SettingsUpdatedBy", fields: [updatedByUserId], references: [id], onDelete: Restrict)

  @@index([logoUploadId])
  @@index([updatedByUserId])
  @@map("factory_settings")
}

model Upload {
  id              Int        @id @default(autoincrement())
  fileName        String     @unique @map("file_name") @db.VarChar(64)
  kind            UploadKind
  width           Int
  height          Int
  sizeBytes       Int        @map("size_bytes")
  createdByUserId Int        @map("created_by_user_id")
  createdAt       DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)

  createdBy     User              @relation("UploadCreatedBy", fields: [createdByUserId], references: [id])
  items         Item[]
  settingsLogos FactorySettings[] @relation("SettingsLogo")

  @@index([createdByUserId])
  @@map("uploads")
}

// ───────────────────────────── Items & stock ─────────────────────────────

model Item {
  id               Int       @id @default(autoincrement())
  name             String    @db.VarChar(200)
  imageUploadId    Int?      @map("image_upload_id")
  depositPrice     BigInt    @map("deposit_price")
  quantityOnHand   Int       @default(0) @map("quantity_on_hand")
  minStock         Int?      @map("min_stock")
  archivedAt       DateTime? @map("archived_at") @db.Timestamptz(3)
  archivedByUserId Int?      @map("archived_by_user_id")
  version          Int       @default(1)
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  createdByUserId  Int       @map("created_by_user_id")

  image          Upload?         @relation(fields: [imageUploadId], references: [id], onDelete: Restrict)
  archivedBy     User?           @relation("ItemArchivedBy", fields: [archivedByUserId], references: [id], onDelete: Restrict)
  createdBy      User            @relation("ItemCreatedBy", fields: [createdByUserId], references: [id])
  batches        PurchaseBatch[]
  stockMovements StockMovement[]
  orderLines     OrderLine[]

  @@index([imageUploadId])
  @@index([archivedAt])
  @@index([archivedByUserId])
  @@index([createdByUserId])
  @@map("items")
}

model PurchaseBatch {
  id              Int       @id @default(autoincrement())
  itemId          Int       @map("item_id")
  date            DateTime  @db.Date
  quantity        Int
  unitCost        BigInt    @map("unit_cost")
  totalCost       BigInt    @map("total_cost")
  note            String?   @db.VarChar(500)
  deletedAt       DateTime? @map("deleted_at") @db.Timestamptz(3)
  deletedByUserId Int?      @map("deleted_by_user_id")
  version         Int       @default(1)
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  createdByUserId Int       @map("created_by_user_id")

  item           Item            @relation(fields: [itemId], references: [id])
  deletedBy      User?           @relation("BatchDeletedBy", fields: [deletedByUserId], references: [id], onDelete: Restrict)
  createdBy      User            @relation("BatchCreatedBy", fields: [createdByUserId], references: [id])
  stockMovements StockMovement[]

  @@index([itemId, date])
  @@index([date])
  @@index([deletedByUserId])
  @@index([createdByUserId])
  @@map("purchase_batches")
}

// Append-only stock ledger. items.quantity_on_hand is the maintained running total.
model StockMovement {
  id              Int                 @id @default(autoincrement())
  itemId          Int                 @map("item_id")
  quantity        Int
  reason          StockMovementReason
  batchId         Int?                @map("batch_id")
  orderId         Int?                @map("order_id")
  returnId        Int?                @map("return_id")
  note            String?             @db.VarChar(500)
  createdByUserId Int                 @map("created_by_user_id")
  createdAt       DateTime            @default(now()) @map("created_at") @db.Timestamptz(3)

  item      Item           @relation(fields: [itemId], references: [id])
  batch     PurchaseBatch? @relation(fields: [batchId], references: [id], onDelete: Restrict)
  order     Order?         @relation(fields: [orderId], references: [id], onDelete: Restrict)
  return    PalletReturn?  @relation(fields: [returnId], references: [id], onDelete: Restrict)
  createdBy User           @relation("StockMovementCreatedBy", fields: [createdByUserId], references: [id])

  @@index([itemId, createdAt])
  @@index([batchId])
  @@index([orderId])
  @@index([returnId])
  @@index([createdByUserId])
  @@map("stock_movements")
}

// ───────────────────────────── Customers & drivers ─────────────────────────────

model Customer {
  id               Int       @id @default(autoincrement())
  name             String    @db.VarChar(200)
  phone            String    @db.VarChar(20)
  altPhone         String?   @map("alt_phone") @db.VarChar(20)
  address          String    @db.VarChar(300)
  creditLimit      BigInt?   @map("credit_limit")
  archivedAt       DateTime? @map("archived_at") @db.Timestamptz(3)
  archivedByUserId Int?      @map("archived_by_user_id")
  version          Int       @default(1)
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  createdByUserId  Int       @map("created_by_user_id")

  archivedBy User?   @relation("CustomerArchivedBy", fields: [archivedByUserId], references: [id], onDelete: Restrict)
  createdBy  User    @relation("CustomerCreatedBy", fields: [createdByUserId], references: [id])
  orders     Order[]

  @@index([phone])
  @@index([altPhone])
  @@index([archivedAt])
  @@index([archivedByUserId])
  @@index([createdByUserId])
  @@map("customers")
}

model Driver {
  id               Int       @id @default(autoincrement())
  name             String    @db.VarChar(200)
  phone            String    @db.VarChar(20)
  carNumber        String    @map("car_number") @db.VarChar(50)
  archivedAt       DateTime? @map("archived_at") @db.Timestamptz(3)
  archivedByUserId Int?      @map("archived_by_user_id")
  version          Int       @default(1)
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  createdByUserId  Int       @map("created_by_user_id")

  archivedBy User?   @relation("DriverArchivedBy", fields: [archivedByUserId], references: [id], onDelete: Restrict)
  createdBy  User    @relation("DriverCreatedBy", fields: [createdByUserId], references: [id])
  orders     Order[]

  @@index([archivedAt])
  @@index([archivedByUserId])
  @@index([createdByUserId])
  @@map("drivers")
}

// ───────────────────────────── Orders ─────────────────────────────

// Single-row counter (id = 1) for gap-free order numbers, locked FOR UPDATE on allocation.
model OrderCounter {
  id         Int @id @default(1)
  lastNumber Int @default(0) @map("last_number")

  @@map("order_counter")
}

model Order {
  id                     Int         @id @default(autoincrement())
  orderNumber            Int         @unique @map("order_number")
  customerId             Int         @map("customer_id")
  driverId               Int         @map("driver_id")
  date                   DateTime    @db.Date
  paymentType            PaymentType @map("payment_type")
  notes                  String?     @db.VarChar(1000)
  // Maintained derived values (cache of section 4 formulas; written only by recomputeOrder()).
  status                 OrderStatus @default(OPEN)
  depositTotal           BigInt      @default(0) @map("deposit_total")
  paymentsNet            BigInt      @default(0) @map("payments_net")
  creditsTotal           BigInt      @default(0) @map("credits_total")
  refundsNet             BigInt      @default(0) @map("refunds_net")
  owed                   BigInt      @default(0)
  outQuantityTotal       Int         @default(0) @map("out_quantity_total")
  outValue               BigInt      @default(0) @map("out_value")
  held                   BigInt      @default(0)
  compensation           BigInt      @default(0)
  // Lifecycle
  cancelledAt            DateTime?   @map("cancelled_at") @db.Timestamptz(3)
  cancelledByUserId      Int?        @map("cancelled_by_user_id")
  creditOverrideByUserId Int?        @map("credit_override_by_user_id")
  creditOverrideAt       DateTime?   @map("credit_override_at") @db.Timestamptz(3)
  version                Int         @default(1)
  createdAt              DateTime    @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt              DateTime    @updatedAt @map("updated_at") @db.Timestamptz(3)
  createdByUserId        Int         @map("created_by_user_id")

  customer         Customer        @relation(fields: [customerId], references: [id])
  driver           Driver          @relation(fields: [driverId], references: [id])
  cancelledBy      User?           @relation("OrderCancelledBy", fields: [cancelledByUserId], references: [id], onDelete: Restrict)
  creditOverrideBy User?           @relation("OrderCreditOverrideBy", fields: [creditOverrideByUserId], references: [id], onDelete: Restrict)
  createdBy        User            @relation("OrderCreatedBy", fields: [createdByUserId], references: [id])
  lines            OrderLine[]
  returns          PalletReturn[]
  ledgerEntries    LedgerEntry[]
  stockMovements   StockMovement[]

  @@index([customerId, status])
  @@index([driverId])
  @@index([date])
  @@index([status, date])
  @@index([cancelledByUserId])
  @@index([creditOverrideByUserId])
  @@index([createdByUserId])
  @@map("orders")
}

model OrderLine {
  id               Int      @id @default(autoincrement())
  orderId          Int      @map("order_id")
  itemId           Int      @map("item_id")
  quantity         Int
  unitDeposit      BigInt   @map("unit_deposit")
  lineTotal        BigInt   @map("line_total")
  // Maintained derived values (written only by recomputeOrder()).
  returnedAccepted Int      @default(0) @map("returned_accepted")
  returnedDamaged  Int      @default(0) @map("returned_damaged")
  outQuantity      Int      @map("out_quantity")
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  order       Order        @relation(fields: [orderId], references: [id])
  item        Item         @relation(fields: [itemId], references: [id])
  returnLines ReturnLine[]

  @@unique([orderId, itemId])
  @@index([itemId])
  @@map("order_lines")
}

// ───────────────────────────── Returns ─────────────────────────────

// Never updated except the one-time reversal columns; never deleted (trigger + column grants).
model PalletReturn {
  id                 Int                 @id @default(autoincrement())
  orderId            Int                 @map("order_id")
  date               DateTime            @db.Date
  notes              String?             @db.VarChar(1000)
  refundDue          BigInt              @map("refund_due")
  owedBefore         BigInt              @map("owed_before")
  cashRefund         BigInt              @map("cash_refund")
  reversedAt         DateTime?           @map("reversed_at") @db.Timestamptz(3)
  reversedByUserId   Int?                @map("reversed_by_user_id")
  reversalKind       ReturnReversalKind? @map("reversal_kind")
  replacedByReturnId Int?                @unique @map("replaced_by_return_id")
  createdAt          DateTime            @default(now()) @map("created_at") @db.Timestamptz(3)
  createdByUserId    Int                 @map("created_by_user_id")

  order          Order           @relation(fields: [orderId], references: [id])
  reversedBy     User?           @relation("ReturnReversedBy", fields: [reversedByUserId], references: [id], onDelete: Restrict)
  createdBy      User            @relation("ReturnCreatedBy", fields: [createdByUserId], references: [id])
  replacedBy     PalletReturn?   @relation("ReturnReplacement", fields: [replacedByReturnId], references: [id], onDelete: Restrict)
  replaces       PalletReturn?   @relation("ReturnReplacement")
  lines          ReturnLine[]
  ledgerEntries  LedgerEntry[]
  stockMovements StockMovement[]

  @@index([orderId])
  @@index([date])
  @@index([reversedByUserId])
  @@index([createdByUserId])
  @@map("returns")
}

model ReturnLine {
  id               Int      @id @default(autoincrement())
  returnId         Int      @map("return_id")
  orderLineId      Int      @map("order_line_id")
  acceptedQuantity Int      @map("accepted_quantity")
  damagedQuantity  Int      @map("damaged_quantity")
  unitDeposit      BigInt   @map("unit_deposit")
  damagedRefund    BigInt   @map("damaged_refund")
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  return    PalletReturn @relation(fields: [returnId], references: [id])
  orderLine OrderLine    @relation(fields: [orderLineId], references: [id])

  @@unique([returnId, orderLineId])
  @@index([orderLineId])
  @@map("return_lines")
}

// ───────────────────────────── Money ledger ─────────────────────────────

// Append-only. Corrections are reversing rows (reverses_entry_id).
model LedgerEntry {
  id              Int               @id @default(autoincrement())
  orderId         Int               @map("order_id")
  type            LedgerEntryType
  source          LedgerEntrySource
  amount          BigInt
  date            DateTime?         @db.Date
  isAutomatic     Boolean           @default(false) @map("is_automatic")
  returnId        Int?              @map("return_id")
  reversesEntryId Int?              @unique @map("reverses_entry_id")
  note            String?           @db.VarChar(500)
  createdAt       DateTime          @default(now()) @map("created_at") @db.Timestamptz(3)
  createdByUserId Int               @map("created_by_user_id")

  order      Order         @relation(fields: [orderId], references: [id])
  return     PalletReturn? @relation(fields: [returnId], references: [id], onDelete: Restrict)
  reverses   LedgerEntry?  @relation("LedgerReversal", fields: [reversesEntryId], references: [id], onDelete: Restrict)
  reversedBy LedgerEntry?  @relation("LedgerReversal")
  createdBy  User          @relation("LedgerEntryCreatedBy", fields: [createdByUserId], references: [id])

  @@index([orderId])
  @@index([type, date])
  @@index([date])
  @@index([returnId])
  @@index([createdByUserId])
  @@map("ledger_entries")
}

// ───────────────────────────── Idempotency & audit ─────────────────────────────

model IdempotencyKey {
  id             Int              @id @default(autoincrement())
  userId         Int              @map("user_id")
  key            String           @db.VarChar(100)
  scope          IdempotencyScope
  requestHash    String           @map("request_hash") @db.Char(64)
  responseStatus Int              @map("response_status")
  responseBody   Json             @map("response_body")
  createdAt      DateTime         @default(now()) @map("created_at") @db.Timestamptz(3)
  expiresAt      DateTime         @map("expires_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id])

  @@unique([userId, key])
  @@index([expiresAt])
  @@map("idempotency_keys")
}

// Append-only (the application role has only SELECT, INSERT).
model AuditLog {
  id              Int             @id @default(autoincrement())
  createdAt       DateTime        @default(now()) @map("created_at") @db.Timestamptz(3)
  userId          Int?            @map("user_id")
  usernameAttempt String?         @map("username_attempt") @db.VarChar(64)
  action          AuditAction
  entityType      AuditEntityType @map("entity_type")
  entityId        String?         @map("entity_id") @db.VarChar(64)
  summaryKey      String          @map("summary_key") @db.VarChar(100)
  summaryParams   Json            @default("{}") @map("summary_params")
  ip              String?         @db.VarChar(45)
  requestId       String?         @map("request_id") @db.VarChar(64)
  before          Json?
  after           Json?

  user User? @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@index([createdAt])
  @@index([userId, createdAt])
  @@index([entityType, entityId])
  @@index([action, createdAt])
  @@map("audit_logs")
}
```

### 5.11 Integrity SQL (`apps/api/prisma/sql/constraints.sql`, verbatim)

```sql
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Pallet System — integrity rules Prisma cannot express.
-- Appended verbatim to the END of the initial migration
-- (apps/api/prisma/migrations/<timestamp>_init/migration.sql). PostgreSQL 18.
-- Naming: CHECK constraints `<table>_<rule>_check`; triggers named per table.
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- ─── users ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD CONSTRAINT users_username_format_check CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  ADD CONSTRAINT users_display_name_not_blank_check CHECK (btrim(display_name) <> ''),
  ADD CONSTRAINT users_token_version_nonnegative_check CHECK (token_version >= 0),
  ADD CONSTRAINT users_version_positive_check CHECK (version >= 1);

-- ─── sessions ────────────────────────────────────────────────────────────────────────────
ALTER TABLE session_families
  ADD CONSTRAINT session_families_revocation_consistent_check
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL));

ALTER TABLE refresh_tokens
  ADD CONSTRAINT refresh_tokens_token_hash_format_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT refresh_tokens_rotated_at_consistent_check CHECK (
    (status = 'ACTIVE' AND rotated_at IS NULL)
    OR (status IN ('ROTATED', 'RETIRED') AND rotated_at IS NOT NULL)
    OR status = 'REVOKED'
  );

-- At most one ACTIVE token per session family (the family "head").
CREATE UNIQUE INDEX refresh_tokens_one_active_per_family
  ON refresh_tokens (family_id)
  WHERE status = 'ACTIVE';

ALTER TABLE login_throttles
  ADD CONSTRAINT login_throttles_failure_count_nonnegative_check CHECK (failure_count >= 0),
  ADD CONSTRAINT login_throttles_lockout_count_nonnegative_check CHECK (lockout_count >= 0);

-- ─── settings & uploads ─────────────────────────────────────────────────────────────────
ALTER TABLE factory_settings
  ADD CONSTRAINT factory_settings_singleton_check CHECK (id = 1),
  ADD CONSTRAINT factory_settings_version_positive_check CHECK (version >= 1);

ALTER TABLE uploads
  ADD CONSTRAINT uploads_file_name_format_check CHECK (file_name ~ '^[0-9a-f]{32}\.webp$'),
  ADD CONSTRAINT uploads_dimensions_positive_check CHECK (width > 0 AND height > 0),
  ADD CONSTRAINT uploads_size_bytes_positive_check CHECK (size_bytes > 0);

-- ─── items & purchase batches ───────────────────────────────────────────────────────────
ALTER TABLE items
  ADD CONSTRAINT items_name_not_blank_check CHECK (btrim(name) <> ''),
  ADD CONSTRAINT items_deposit_price_nonnegative_check CHECK (deposit_price >= 0),
  ADD CONSTRAINT items_quantity_on_hand_nonnegative_check CHECK (quantity_on_hand >= 0),
  ADD CONSTRAINT items_min_stock_nonnegative_check CHECK (min_stock IS NULL OR min_stock >= 0),
  ADD CONSTRAINT items_archive_consistent_check CHECK ((archived_at IS NULL) = (archived_by_user_id IS NULL)),
  ADD CONSTRAINT items_version_positive_check CHECK (version >= 1);

ALTER TABLE purchase_batches
  ADD CONSTRAINT purchase_batches_quantity_positive_check CHECK (quantity > 0),
  ADD CONSTRAINT purchase_batches_unit_cost_nonnegative_check CHECK (unit_cost >= 0),
  ADD CONSTRAINT purchase_batches_total_cost_matches_check CHECK (total_cost = quantity::bigint * unit_cost),
  ADD CONSTRAINT purchase_batches_delete_consistent_check CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL)),
  ADD CONSTRAINT purchase_batches_version_positive_check CHECK (version >= 1);

-- ─── stock ledger ───────────────────────────────────────────────────────────────────────
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_quantity_nonzero_check CHECK (quantity <> 0),
  ADD CONSTRAINT stock_movements_reference_matches_reason_check CHECK (
    (reason IN ('BATCH_ADD', 'BATCH_EDIT', 'BATCH_DELETE')
      AND batch_id IS NOT NULL AND order_id IS NULL AND return_id IS NULL)
    OR (reason IN ('ORDER_CREATE', 'ORDER_LINE_EDIT', 'ORDER_CANCEL')
      AND order_id IS NOT NULL AND batch_id IS NULL AND return_id IS NULL)
    OR (reason IN ('RETURN_ACCEPTED', 'RETURN_EDIT', 'RETURN_DELETE')
      AND return_id IS NOT NULL AND order_id IS NOT NULL AND batch_id IS NULL)
    OR (reason = 'MANUAL_ADJUSTMENT'
      AND note IS NOT NULL AND btrim(note) <> '' AND batch_id IS NULL AND order_id IS NULL AND return_id IS NULL)
  ),
  ADD CONSTRAINT stock_movements_quantity_sign_check CHECK (
    (reason IN ('BATCH_ADD', 'ORDER_CANCEL', 'RETURN_ACCEPTED') AND quantity > 0)
    OR (reason IN ('BATCH_DELETE', 'ORDER_CREATE', 'RETURN_EDIT', 'RETURN_DELETE') AND quantity < 0)
    OR reason IN ('BATCH_EDIT', 'ORDER_LINE_EDIT', 'MANUAL_ADJUSTMENT')
  );

-- ─── customers & drivers ────────────────────────────────────────────────────────────────
ALTER TABLE customers
  ADD CONSTRAINT customers_name_not_blank_check CHECK (btrim(name) <> ''),
  ADD CONSTRAINT customers_phone_format_check CHECK (phone ~ '^\+?[0-9]{7,15}$'),
  ADD CONSTRAINT customers_alt_phone_format_check CHECK (alt_phone IS NULL OR alt_phone ~ '^\+?[0-9]{7,15}$'),
  ADD CONSTRAINT customers_credit_limit_nonnegative_check CHECK (credit_limit IS NULL OR credit_limit >= 0),
  ADD CONSTRAINT customers_archive_consistent_check CHECK ((archived_at IS NULL) = (archived_by_user_id IS NULL)),
  ADD CONSTRAINT customers_version_positive_check CHECK (version >= 1);

ALTER TABLE drivers
  ADD CONSTRAINT drivers_name_not_blank_check CHECK (btrim(name) <> ''),
  ADD CONSTRAINT drivers_phone_format_check CHECK (phone ~ '^\+?[0-9]{7,15}$'),
  ADD CONSTRAINT drivers_car_number_not_blank_check CHECK (btrim(car_number) <> ''),
  ADD CONSTRAINT drivers_archive_consistent_check CHECK ((archived_at IS NULL) = (archived_by_user_id IS NULL)),
  ADD CONSTRAINT drivers_version_positive_check CHECK (version >= 1);

-- ─── orders ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE order_counter
  ADD CONSTRAINT order_counter_singleton_check CHECK (id = 1),
  ADD CONSTRAINT order_counter_last_number_nonnegative_check CHECK (last_number >= 0);

ALTER TABLE orders
  ADD CONSTRAINT orders_order_number_positive_check CHECK (order_number >= 1),
  ADD CONSTRAINT orders_totals_nonnegative_check CHECK (
    deposit_total >= 0 AND payments_net >= 0 AND credits_total >= 0 AND refunds_net >= 0
    AND owed >= 0 AND out_quantity_total >= 0 AND out_value >= 0 AND held >= 0 AND compensation >= 0
  ),
  ADD CONSTRAINT orders_cancel_consistent_check CHECK (
    (cancelled_at IS NULL) = (cancelled_by_user_id IS NULL)
    AND (status = 'CANCELLED') = (cancelled_at IS NOT NULL)
  ),
  ADD CONSTRAINT orders_credit_override_consistent_check
    CHECK ((credit_override_by_user_id IS NULL) = (credit_override_at IS NULL)),
  ADD CONSTRAINT orders_version_positive_check CHECK (version >= 1);

ALTER TABLE order_lines
  ADD CONSTRAINT order_lines_quantity_positive_check CHECK (quantity > 0),
  ADD CONSTRAINT order_lines_unit_deposit_nonnegative_check CHECK (unit_deposit >= 0),
  ADD CONSTRAINT order_lines_line_total_matches_check CHECK (line_total = quantity::bigint * unit_deposit),
  ADD CONSTRAINT order_lines_returned_nonnegative_check CHECK (returned_accepted >= 0 AND returned_damaged >= 0),
  -- Q39: the second branch is a cancelled order's zeroed line (§4.2).
  ADD CONSTRAINT order_lines_out_quantity_matches_check CHECK (
    out_quantity = quantity - returned_accepted - returned_damaged
    OR (out_quantity = 0 AND returned_accepted = 0 AND returned_damaged = 0)
  ),
  ADD CONSTRAINT order_lines_out_quantity_nonnegative_check CHECK (out_quantity >= 0);

-- ─── returns ────────────────────────────────────────────────────────────────────────────
ALTER TABLE returns
  ADD CONSTRAINT returns_money_nonnegative_check CHECK (refund_due >= 0 AND owed_before >= 0 AND cash_refund >= 0),
  ADD CONSTRAINT returns_cash_refund_formula_check CHECK (cash_refund = GREATEST(0, refund_due - owed_before)),
  ADD CONSTRAINT returns_reversal_consistent_check CHECK (
    (reversed_at IS NULL) = (reversed_by_user_id IS NULL)
    AND (reversed_at IS NULL) = (reversal_kind IS NULL)
  ),
  ADD CONSTRAINT returns_replacement_matches_kind_check CHECK (
    (reversal_kind IS NULL AND replaced_by_return_id IS NULL)
    OR (reversal_kind = 'DELETE' AND replaced_by_return_id IS NULL)
    OR (reversal_kind = 'EDIT' AND replaced_by_return_id IS NOT NULL)
  ),
  ADD CONSTRAINT returns_not_self_replaced_check CHECK (replaced_by_return_id IS NULL OR replaced_by_return_id <> id);

ALTER TABLE return_lines
  ADD CONSTRAINT return_lines_quantities_nonnegative_check CHECK (accepted_quantity >= 0 AND damaged_quantity >= 0),
  ADD CONSTRAINT return_lines_quantity_positive_check CHECK (accepted_quantity + damaged_quantity > 0),
  ADD CONSTRAINT return_lines_unit_deposit_nonnegative_check CHECK (unit_deposit >= 0),
  ADD CONSTRAINT return_lines_damaged_refund_range_check
    CHECK (damaged_refund >= 0 AND damaged_refund <= damaged_quantity::bigint * unit_deposit);

-- ─── money ledger ───────────────────────────────────────────────────────────────────────
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_amount_positive_check CHECK (amount > 0),
  ADD CONSTRAINT ledger_entries_reversal_reference_check
    CHECK ((type IN ('PAYMENT_REVERSAL', 'REFUND_REVERSAL')) = (reverses_entry_id IS NOT NULL)),
  ADD CONSTRAINT ledger_entries_not_self_reversal_check CHECK (reverses_entry_id IS NULL OR reverses_entry_id <> id),
  ADD CONSTRAINT ledger_entries_automatic_only_payment_check CHECK (NOT is_automatic OR type = 'PAYMENT'),
  ADD CONSTRAINT ledger_entries_date_null_only_automatic_check
    CHECK ((date IS NULL) = (is_automatic AND type = 'PAYMENT')),
  ADD CONSTRAINT ledger_entries_return_reference_check CHECK (
    (type IN ('REFUND', 'REFUND_REVERSAL') AND return_id IS NOT NULL)
    OR (type IN ('PAYMENT', 'PAYMENT_REVERSAL') AND return_id IS NULL)
  ),
  ADD CONSTRAINT ledger_entries_source_matches_type_check CHECK (
    (type = 'PAYMENT' AND is_automatic AND source IN ('ORDER_CREATE', 'ORDER_LINE_EDIT'))
    OR (type = 'PAYMENT' AND NOT is_automatic AND source = 'MANUAL')
    OR (type = 'PAYMENT_REVERSAL' AND source IN ('ORDER_LINE_EDIT', 'ORDER_CANCEL', 'PAYMENT_DELETE'))
    OR (type = 'REFUND' AND source IN ('RETURN_CREATE', 'RETURN_EDIT'))
    OR (type = 'REFUND_REVERSAL' AND source IN ('RETURN_EDIT', 'RETURN_DELETE'))
  );

-- ─── idempotency ────────────────────────────────────────────────────────────────────────
ALTER TABLE idempotency_keys
  ADD CONSTRAINT idempotency_keys_key_format_check CHECK (key ~ '^[A-Za-z0-9_-]{16,100}$'),
  ADD CONSTRAINT idempotency_keys_request_hash_format_check CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT idempotency_keys_expiry_after_creation_check CHECK (expires_at > created_at);

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Triggers
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- Append-only tables: no UPDATE, no DELETE, for any role (defence in depth on top of grants).
-- Row triggers do not fire on TRUNCATE, so the test suite's reset and pg_restore still work.
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% forbidden)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER forbid_update_delete BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER forbid_update_delete BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER forbid_update_delete BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER forbid_update_delete BEFORE UPDATE OR DELETE ON return_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Returns are never deleted.
CREATE TRIGGER forbid_delete BEFORE DELETE ON returns
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Returns: the only permitted UPDATE sets the four reversal columns once (from NULL), in one statement.
CREATE OR REPLACE FUNCTION returns_reversal_set_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'return % is already reversed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reversed_at IS NULL THEN
    RAISE EXCEPTION 'an UPDATE on returns must set reversed_at' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.id, NEW.order_id, NEW.date, NEW.notes, NEW.refund_due, NEW.owed_before, NEW.cash_refund,
      NEW.created_at, NEW.created_by_user_id)
     IS DISTINCT FROM
     (OLD.id, OLD.order_id, OLD.date, OLD.notes, OLD.refund_due, OLD.owed_before, OLD.cash_refund,
      OLD.created_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'only reversal columns of returns may be updated' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER returns_reversal_set_once BEFORE UPDATE ON returns
  FOR EACH ROW EXECUTE FUNCTION returns_reversal_set_once();

-- Ledger: a reversal row must mirror the row it reverses (same order, same amount, matching type).
CREATE OR REPLACE FUNCTION ledger_reversal_matches_original() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  original ledger_entries%ROWTYPE;
BEGIN
  IF NEW.reverses_entry_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO original FROM ledger_entries WHERE id = NEW.reverses_entry_id;
  IF NOT FOUND
     OR original.order_id <> NEW.order_id
     OR original.amount <> NEW.amount
     OR (NEW.type = 'PAYMENT_REVERSAL' AND original.type <> 'PAYMENT')
     OR (NEW.type = 'REFUND_REVERSAL' AND original.type <> 'REFUND') THEN
    RAISE EXCEPTION 'ledger reversal % does not mirror entry %', NEW.id, NEW.reverses_entry_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_reversal_matches_original BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_reversal_matches_original();

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Seed rows required by the schema itself
-- ═══════════════════════════════════════════════════════════════════════════════════════
INSERT INTO order_counter (id, last_number) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
```

### 5.12 Grants (`apps/api/prisma/sql/grants.sql`, verbatim)

```sql
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Pallet System — least-privilege grants for the runtime role `pallet_app`.
-- Idempotent: revokes everything, then grants exactly the matrix in ARCHITECTURE.md §5.7.
-- Run as `pallet_owner` after EVERY `prisma migrate deploy`:
--   prisma db execute --file prisma/sql/grants.sql
-- A new table added by a future migration MUST be added to this file (the integration
-- suite asserts that pallet_app has a privilege on every application table).
-- ═══════════════════════════════════════════════════════════════════════════════════════
BEGIN;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pallet_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM pallet_app;
GRANT USAGE ON SCHEMA public TO pallet_app;

-- Full CRUD (mutable state and maintained caches)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users,
  user_permissions,
  session_families,
  refresh_tokens,
  login_throttles,
  factory_settings,
  uploads,
  items,
  purchase_batches,
  customers,
  drivers,
  order_counter,
  orders,
  order_lines,
  idempotency_keys
TO pallet_app;

-- Append-only ledgers and history (no UPDATE, no DELETE)
GRANT SELECT, INSERT ON
  audit_logs,
  stock_movements,
  ledger_entries,
  return_lines
TO pallet_app;

-- Returns: insert, plus a one-time UPDATE of the reversal columns only (trigger enforces "once")
GRANT SELECT, INSERT ON returns TO pallet_app;
GRANT UPDATE (reversed_at, reversed_by_user_id, reversal_kind, replaced_by_return_id) ON returns TO pallet_app;

-- Identity sequences for INSERT
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pallet_app;

-- `_prisma_migrations` intentionally receives nothing.
COMMIT;
```

### 5.13 First-run role creation (`deploy/postgres/init/01-roles.sh`, verbatim)

```bash
#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════════════
# Pallet System — PostgreSQL first-run initialisation.
# Mounted into /docker-entrypoint-initdb.d of the official postgres image; it runs ONCE,
# only when the pgdata volume is empty. It creates:
#   pallet_owner  LOGIN CREATEDB  — owns database `pallet` and schema public; runs migrations
#   pallet_app    LOGIN           — runtime role used by the API (table grants: prisma/sql/grants.sql)
# Required environment: POSTGRES_USER (superuser, set by the image), DB_OWNER_PASSWORD, DB_APP_PASSWORD.
# ═══════════════════════════════════════════════════════════════════════════════════════
set -euo pipefail

: "${DB_OWNER_PASSWORD:?DB_OWNER_PASSWORD must be set}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "${POSTGRES_DB:-$POSTGRES_USER}" \
  -v owner_pw="$DB_OWNER_PASSWORD" \
  -v app_pw="$DB_APP_PASSWORD" <<'SQL'
CREATE ROLE pallet_owner LOGIN CREATEDB PASSWORD :'owner_pw';
CREATE ROLE pallet_app LOGIN PASSWORD :'app_pw';
CREATE DATABASE pallet OWNER pallet_owner ENCODING 'UTF8' TEMPLATE template0;
SQL

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname pallet <<'SQL'
REVOKE ALL ON DATABASE pallet FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE pallet TO pallet_owner;
GRANT CONNECT ON DATABASE pallet TO pallet_app;

ALTER SCHEMA public OWNER TO pallet_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO pallet_app;

-- Runtime safety nets for the application role.
ALTER ROLE pallet_app IN DATABASE pallet SET statement_timeout = '30s';
ALTER ROLE pallet_app IN DATABASE pallet SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE pallet_app IN DATABASE pallet SET timezone = 'UTC';
ALTER ROLE pallet_owner IN DATABASE pallet SET timezone = 'UTC';
SQL

echo "pallet init: roles pallet_owner, pallet_app and database pallet created"
```



## 6. API specification

This section is normative for `apps/api`. Every name below (paths, query parameters, body fields, DTO fields, error codes, schema names) is exact. Request schemas are written in zod notation and live in `packages/shared/src/schemas/<module>.ts`; DTO interfaces live in `packages/shared/src/schemas/dto.ts`. Both are exported from `@pallet/shared` and used by the API (validation, response typing) and by the web app (forms, query typing).

### 6.1 Conventions

#### 6.1.1 Transport

| Rule | Value |
|---|---|
| Base path | `/api` (Nest global prefix `api`). Every path in this section is absolute and includes `/api`. |
| Origin | Same origin as the web app (Caddy routes `/api/*` to the API). No URL versioning. |
| Request content type | `application/json` for every body, except `POST /api/uploads` (`multipart/form-data`). |
| Response content type | `application/json; charset=utf-8`, except `GET /api/uploads/:fileName` (`image/webp`) and 204 responses (no body). |
| JSON body size limit | 100 KiB (`express.json({ limit: '100kb' })`); larger → 413 `PAYLOAD_TOO_LARGE`. |
| Character set | UTF-8. Text fields are stored exactly as typed after `trim()` (leading/trailing whitespace removed); empty-after-trim optional text becomes `null`. |
| Unknown routes | 404 `ROUTE_NOT_FOUND`. |

#### 6.1.2 Headers

| Header | Direction | Rule |
|---|---|---|
| `Authorization: Bearer <accessToken>` | request | Required on every endpoint except those marked **Public**. |
| `X-Requested-With: pallet-web` | request | Required (exact value) on every `POST`, `PUT`, `PATCH`, `DELETE`, including Public ones (login, refresh, logout). Missing or different → 403 `CSRF_HEADER_MISSING`. Not required on `GET`. |
| `Idempotency-Key: <key>` | request | Required on `POST /api/orders`, `POST /api/orders/:orderId/returns`, `POST /api/orders/:orderId/payments`. Format `^[A-Za-z0-9_-]{16,100}$`. Ignored on every other endpoint. See 6.7. |
| `Idempotency-Replayed: true` | response | Present only when the response is a stored idempotent replay. |
| `X-Request-Id` | response | Always generated by the API (UUID v4, §10.6 D8); an incoming value is ignored. It is echoed on every response, logged on every log line, stored in `audit_logs.request_id`, and returned as `requestId` in error bodies — a client-chosen value would let anyone forge or collide the correlation column of the append-only audit log. |
| `Retry-After: <seconds>` | response | Present on every 429 `RATE_LIMITED`. |
| `Set-Cookie: pallet_rt=…` | response | Only on login, refresh, change-password (set) and logout/refresh failure (clear). See 6.8. |

#### 6.1.3 JSON value types

| Kind | Wire type | Rule |
|---|---|---|
| Id | integer | 1 … 2,147,483,647. Path params are parsed with `IdParam`; a non-matching value → 400 `VALIDATION_FAILED` (path = param name). Session ids (uuid) never appear on the wire. |
| Money | integer (JSON number) | Whole IQD. Database `bigint` is converted to `number` by `toSafeMoney()` which throws if `!Number.isSafeInteger`. User-entered money is 0 … 1,000,000,000,000 (`MONEY_INPUT_MAX`). Money is never a string and never fractional. |
| Quantity | integer | User-entered quantities 1 … 1,000,000 (`QUANTITY_INPUT_MAX`) unless a schema says 0 is allowed. |
| Computed money overflow | — | Any product computed from input (`quantity × unitDeposit`, `quantity × unitCost`) that exceeds `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991) → 400 `VALIDATION_FAILED` on the price field (`code: 'too_big'`, `params: { maximum: 9007199254740991 }`). |
| Business date | string `YYYY-MM-DD` | An Asia/Baghdad calendar day. Schema `BusinessDate` checks the pattern, that it is a real calendar date (`invalid_date`) and that it is ≥ `2000-01-01` (`too_small`). The service rejects dates after today (Asia/Baghdad) with 400 `BUSINESS_DATE_IN_FUTURE`. |
| Timestamp | string ISO-8601 UTC | Always `YYYY-MM-DDTHH:mm:ss.sssZ`. |
| Boolean query | string | `true` or `false` only (`BoolQuery`); any other value → `VALIDATION_FAILED` (`invalid_enum`). |
| Enum | string | Exactly the values in `packages/shared/src/enums.ts`. |
| Optional text | string or `null` | Trimmed; empty string after trim is stored and returned as `null`. |

#### 6.1.4 Shared zod primitives (`packages/shared/src/schemas/common.ts`)

```ts
export const IdParam        = z.coerce.number().int().min(1).max(2_147_483_647);
export const Id             = z.int().min(1).max(2_147_483_647);
export const Version        = z.int().min(1).max(2_147_483_647);
export const VersionQuery   = z.strictObject({ version: z.coerce.number().int().min(1) });
export const Money          = z.int().min(0).max(MONEY_INPUT_MAX);           // 0 … 1e12
export const PositiveMoney  = z.int().min(1).max(MONEY_INPUT_MAX);           // 1 … 1e12
export const Quantity       = z.int().min(1).max(QUANTITY_INPUT_MAX);        // 1 … 1e6
export const NonNegQuantity = z.int().min(0).max(QUANTITY_INPUT_MAX);        // 0 … 1e6
export const BusinessDate   = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)       // + refine: real date (custom 'invalid_date'), ≥ 2000-01-01 (custom 'too_small')
export const Name200        = z.string().trim().min(1).max(200);
export const optionalText   = (max: number) => z.string().trim().max(max).nullable().optional()
                                .transform((v) => (v === undefined ? undefined : v === '' || v === null ? null : v));
export const Phone          = z.string().max(40)
                                .transform(normalizePhone)                   // §8.7: Western digits, then no spaces, dashes, parentheses
                                .pipe(z.string().regex(/^\+?[0-9]{7,15}$/));   // stored normalized
export const SearchQuery    = z.string().trim().max(100).optional().transform((v) => (v ? v : undefined));
export const BoolQuery      = z.enum(['true', 'false']).transform((v) => v === 'true');
export const PageQuery      = { page: z.coerce.number().int().min(1).default(1),
                                pageSize: z.coerce.number().int().min(1).max(100).default(25) };
export const sortParam      = <F extends string>(fields: readonly F[], dflt: `${'' | '-'}${F}`) =>
                                z.enum([...fields, ...fields.map((f) => `-${f}`)] as [string, ...string[]]).default(dflt);
export const dateRange      = { dateFrom: BusinessDate.optional(), dateTo: BusinessDate.optional() };
                              // refine on the object: dateFrom ≤ dateTo, else 400 DATE_RANGE_INVALID (raised by the pipe, not a field error)
```

Every body and query schema is a `z.strictObject` (unknown keys → `VALIDATION_FAILED` with `code: 'unknown_key'`). "At least one field besides `version`" rules are object-level refinements that report `path: ''`, `code: 'required'`.

### 6.2 Lists: pagination, filtering, sorting, search

| Rule | Value |
|---|---|
| Paging parameters | `page` (≥ 1, default 1), `pageSize` (1 … 100, default 25; audit log default 50). |
| Paged response | `PageDto<T> = { items: T[]; page: number; pageSize: number; total: number }`. `total` = count of rows matching the filters. A `page` beyond the last returns `items: []` with the correct `total`. |
| Paging method | SQL `LIMIT pageSize OFFSET (page − 1) × pageSize`. |
| Sort | `sort=<field>` ascending, `sort=-<field>` descending. Each endpoint lists its allowed fields and default. Every sort appends `id` in the same direction as the final tiebreaker so paging is stable. |
| Search | `q` (trimmed, 1 … 100 chars, empty = absent): case-insensitive `ILIKE '%' || q || '%'` on the columns listed per endpoint; `%`, `_` and `\` inside `q` are escaped. |
| Archived rows | Items, customers and drivers lists exclude archived rows unless `includeArchived=true`. |
| Cancelled orders | Excluded from every aggregate. Order lists include them only for `status=CANCELLED` or `status=ALL`. |
| Date filters | `dateFrom` / `dateTo` are inclusive business dates. For timestamp columns (audit log) the range is `created_at >= (dateFrom 00:00 Asia/Baghdad)` and `created_at < (dateTo + 1 day 00:00 Asia/Baghdad)`. |
| Non-paged endpoints | Reports, dashboard, receipt, order detail, customer detail return complete objects (no `PageDto`). |

### 6.3 Errors

#### 6.3.1 Error body

Every non-2xx response (except 204) has this body (`ApiErrorBody` in `packages/shared/src/error-codes.ts`):

```json
{
  "error": {
    "code": "STOCK_INSUFFICIENT",
    "details": { "items": [{ "itemId": 4, "requested": 120, "available": 80 }] },
    "fields": [{ "path": "lines.0.quantity", "code": "too_big", "params": { "maximum": 1000000 } }]
  },
  "requestId": "0d5f3c1e-7a8b-4c1e-9d2f-5b6a7c8d9e0f"
}
```

- `code` is always a key of `ERROR_CODES`; the HTTP status is always `ERROR_CODES[code]`.
- `details` carries machine-readable context only (ids, numbers, enum values, keys); it never contains prose, never contains cost fields for a user without `items.viewCost`, and is omitted when a code defines no details.
- `fields` is present only with `VALIDATION_FAILED`.
- A single global `ApiExceptionFilter` produces every error body. Services throw `new ApiError(code, details?)` (`apps/api/src/common/errors/api-error.ts`). Unexpected exceptions (including `LedgerInvariantError` and PostgreSQL CHECK/trigger violations, SQLSTATE `23514`/`P0001`) are logged with stack at `error` level, reported to the error tracker, and returned as 500 `INTERNAL_ERROR` without details. A Prisma unique violation (`P2002`) is mapped only where an endpoint lists a specific code (`USERNAME_TAKEN`, idempotency replay); elsewhere it is `INTERNAL_ERROR`.

#### 6.3.2 Zod issue → `ValidationCode` mapping

Implemented once in `packages/shared/src/schemas/zod-issues.ts` (`mapZodIssue(issue): ApiFieldError[]`). `path` is `issue.path.join('.')` (array indexes as numbers).

| Zod 4 issue | Condition | `ValidationCode` | `params` |
|---|---|---|---|
| `invalid_type` | input is `undefined` | `required` | — |
| `invalid_type` | expected `int` (or number with integer check) and input is a non-integer number | `not_integer` | — |
| `invalid_type` | any other | `invalid_type` | `{ expected }` |
| `too_small` | origin `string` | `too_short` | `{ minimum }` |
| `too_small` | origin `number`, `int`, `array`, `bigint`, `date` | `too_small` | `{ minimum }` |
| `too_big` | origin `string` | `too_long` | `{ maximum }` |
| `too_big` | other origins | `too_big` | `{ maximum }` |
| `invalid_format` | any (regex, uuid, email) | `invalid_format` | — |
| `invalid_value` | enum / literal mismatch | `invalid_enum` | `{ options: values.join('|') }` |
| `unrecognized_keys` | one field error per key | `unknown_key` | — (path = parent path + key) |
| `not_multiple_of` | any | `not_integer` | — |
| `custom` | `issue.params.code` is a `ValidationCode` | that code | `issue.params.params` |
| `invalid_union`, any other | — | `invalid_type` | — |

Path and query parameters use the same mapping; their `path` is the parameter name. The web app maps each field error to `validation.<code>` with `params` interpolated.

#### 6.3.3 Error-code catalogue

| Code | HTTP | Raised when | `details` |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | Body, query or path parameter fails its zod schema; computed money overflow (6.1.3). | — (`fields` present) |
| `CSRF_HEADER_MISSING` | 403 | State-changing request without `X-Requested-With: pallet-web`. | — |
| `NOT_FOUND` | 404 | `GET /api/uploads/:fileName` file absent; any entity lookup without a dedicated code. | — |
| `ROUTE_NOT_FOUND` | 404 | No route matches method + path. | — |
| `VERSION_CONFLICT` | 409 | Client `version` ≠ current row version (checked after the row lock). | `{ currentVersion: number }` |
| `PAYLOAD_TOO_LARGE` | 413 | JSON body > 100 KiB. | `{ maxBytes: 102400 }` |
| `RATE_LIMITED` | 429 | A named throttler (6.8.8) is exceeded. | `{ retryAfterSeconds: number }` |
| `INTERNAL_ERROR` | 500 | Any unexpected exception, including ledger invariant violations. | — |
| `SERVICE_UNAVAILABLE` | 503 | `GET /api/health` database probe fails. | — |
| `BUSINESS_DATE_IN_FUTURE` | 400 | A business date (order, return, payment, batch) is after today in Asia/Baghdad. | `{ field: string, today: 'YYYY-MM-DD' }` |
| `DATE_RANGE_INVALID` | 400 | `dateFrom` > `dateTo` on any list or report query. | `{ dateFrom, dateTo }` |
| `AUTH_REQUIRED` | 401 | Protected endpoint called without a Bearer token. | — |
| `AUTH_TOKEN_EXPIRED` | 401 | Access token signature valid but `exp` passed. | — |
| `AUTH_TOKEN_INVALID` | 401 | Malformed token, bad signature, wrong algorithm, unknown user, inactive user, or `tv` ≠ `users.token_version`. | — |
| `AUTH_INVALID_CREDENTIALS` | 401 | Login with unknown username, wrong password, inactive user, or while the (IP, username) pair is locked out — identical response for all four. | — |
| `AUTH_REFRESH_INVALID` | 401 | Refresh cookie missing, unknown, expired, revoked, reused outside the grace rule, family expired, or user inactive. | — |
| `PASSWORD_CHANGE_REQUIRED` | 403 | User has `mustChangePassword = true` and calls any endpoint other than the five listed in 6.8.7. | — |
| `CURRENT_PASSWORD_INCORRECT` | 400 | `POST /api/auth/change-password` with a wrong `currentPassword`. | — |
| `PASSWORD_TOO_SHORT` | 400 | New password < 10 Unicode code points. | `{ minimum: 10 }` |
| `PASSWORD_TOO_LONG` | 400 | New password > 128 Unicode code points. | `{ maximum: 128 }` |
| `PASSWORD_TOO_COMMON` | 400 | New password (lower-cased) is in the bundled common-password list, or equals the username (case-insensitive). | — |
| `PASSWORD_SAME_AS_CURRENT` | 400 | Change-password `newPassword` verifies against the current hash. | — |
| `PERMISSION_DENIED` | 403 | Employee lacks a required permission key. | `{ required: PermissionKey[] }` (the missing keys) |
| `ADMIN_ONLY` | 403 | Employee calls an admin-only operation (users, settings update, factory-logo upload, `confirmCreditOverride: true`). | — |
| `USER_NOT_FOUND` | 404 | `/api/users/:id` target does not exist. | `{ userId }` |
| `USERNAME_TAKEN` | 409 | Create user with an existing username. | `{ username }` |
| `SELF_DEACTIVATE_FORBIDDEN` | 409 | Admin sets `isActive: false` on their own account. | — |
| `SELF_DEMOTE_FORBIDDEN` | 409 | Admin sets `role: 'EMPLOYEE'` on their own account. | — |
| `LAST_ADMIN_GUARD` | 409 | Deactivating or demoting the only remaining active admin. | — |
| `PERMISSION_KEY_UNKNOWN` | 400 | Permission list contains a string that is not a permission key. | `{ keys: string[] }` |
| `PERMISSION_NOT_GRANTABLE` | 400 | Permission list contains an admin-only key. | `{ keys: string[] }` |
| `PERMISSION_DEPENDENCY_MISSING` | 400 | Permission set is not closed under `PERMISSION_DEPENDENCIES`. | `{ missing: GrantablePermissionKey[] }` |
| `PERMISSIONS_ADMIN_IMPLICIT` | 409 | Setting permissions on an ADMIN user, or creating an ADMIN with a non-empty `permissions` array. | — |
| `UPLOAD_MISSING_FILE` | 400 | Multipart request without a `file` part. | — |
| `UPLOAD_TYPE_NOT_ALLOWED` | 415 | Magic bytes are not PNG, JPEG or WebP. | `{ allowed: ['image/png','image/jpeg','image/webp'] }` |
| `UPLOAD_TOO_LARGE` | 413 | File > 5 MiB. | `{ maxBytes: 5242880 }` |
| `UPLOAD_INVALID_IMAGE` | 400 | `sharp` cannot decode the file, or it exceeds 40,000,000 pixels. | — |
| `UPLOAD_NOT_FOUND` | 404 | `imageUploadId` / `logoUploadId` references no upload row. | `{ uploadId }` |
| `UPLOAD_KIND_MISMATCH` | 400 | Referenced upload has the wrong `kind` (item image vs factory logo). | `{ expected: UploadKind, actual: UploadKind }` |
| `ITEM_NOT_FOUND` | 404 | Item id does not exist (path param or `itemId` in a body). | `{ itemId }` |
| `ITEM_ARCHIVED` | 409 | Editing an archived item; adding/increasing an order line or a batch for an archived item. | `{ itemId }` |
| `ITEM_ALREADY_ARCHIVED` | 409 | `DELETE /api/items/:id` on an archived item. | `{ itemId }` |
| `STOCK_INSUFFICIENT` | 409 | Any operation whose stock movements would leave an item's `quantity_on_hand` < 0. | `{ items: [{ itemId, requested, available }] }` (`requested` = units being removed, `available` = on hand before the operation) |
| `BATCH_NOT_FOUND` | 404 | Batch id does not exist or is soft-deleted. | `{ batchId }` |
| `CUSTOMER_NOT_FOUND` | 404 | Customer id does not exist. | `{ customerId }` |
| `CUSTOMER_ARCHIVED` | 409 | New order for an archived customer; editing an archived customer. | `{ customerId }` |
| `CUSTOMER_ALREADY_ARCHIVED` | 409 | `DELETE /api/customers/:id` on an archived customer. | `{ customerId }` |
| `CUSTOMER_PHONE_DUPLICATE` | 409 | `phone`/`altPhone` equals another customer's normalized phone/altPhone and `confirmDuplicatePhone` is not `true`. | `{ matches: [{ customerId, name, archived, matchedField: 'phone' \| 'altPhone', matchedValue }] }` |
| `CUSTOMER_HAS_OPEN_ORDERS` | 409 | Archiving a customer that has at least one order with status `OPEN`. | `{ openOrderCount }` |
| `DRIVER_NOT_FOUND` | 404 | Driver id does not exist. | `{ driverId }` |
| `DRIVER_ARCHIVED` | 409 | New order / order edit assigns an archived driver; editing an archived driver. | `{ driverId }` |
| `DRIVER_ALREADY_ARCHIVED` | 409 | `DELETE /api/drivers/:id` on an archived driver. | `{ driverId }` |
| `ORDER_NOT_FOUND` | 404 | Order id does not exist. | `{ orderId }` |
| `ORDER_CANCELLED` | 409 | Any edit, cancel, return, payment or receipt on a cancelled order. | `{ orderId }` |
| `ORDER_HAS_ACTIVITY` | 409 | Line edit or cancel while the order has a non-reversed return or a non-reversed manual payment. | `{ nonReversedReturnCount, nonReversedManualPaymentCount }` |
| `ORDER_LINE_HAS_RETURNS` | 409 | Line edit removes a line that has return lines, reversed ones included (Q40). | `{ itemId }` |
| `ORDER_DATE_AFTER_ACTIVITY` | 409 | Order `date` edited to later than the earliest non-reversed return date or non-reversed manual payment date. | `{ earliestActivityDate }` |
| `CREDIT_LIMIT_EXCEEDED` | 409 | Credit rule (4.4) fails and the request is not a valid admin override. | `{ creditLimit, customerOutValue, depositDelta, excess, canOverride: boolean }` |
| `UNIT_DEPOSIT_NOT_PERMITTED` | 403 | A line carries `unitDeposit` and the user lacks `orders.editUnitDeposit`. | `{ lineIndexes: number[] }` |
| `RETURN_NOT_FOUND` | 404 | Return id does not exist. | `{ returnId }` |
| `RETURN_EMPTY` | 400 | Return body has `lines: []`. | — |
| `RETURN_LINE_NOT_IN_ORDER` | 400 | `orderLineId` is not a line of this order. | `{ orderLineId }` |
| `RETURN_DUPLICATE_LINE` | 400 | The same `orderLineId` appears twice. | `{ orderLineId }` |
| `RETURN_EXCEEDS_OUT` | 409 | `acceptedQuantity + damagedQuantity` > the line's current `outQuantity`. | `{ lines: [{ orderLineId, requested, outQuantity }] }` |
| `DAMAGED_REFUND_TOO_HIGH` | 400 | `damagedRefund` > `damagedQuantity × unitDeposit`. | `{ orderLineId, maximum }` |
| `RETURN_ALREADY_REVERSED` | 409 | Replace or delete of a return whose `reversedAt` is set. | `{ returnId }` |
| `RETURN_DATE_BEFORE_ORDER_DATE` | 400 | Return `date` < order `date`. | `{ orderDate }` |
| `PAYMENT_ORDER_NOT_LENT` | 409 | Manual payment on a `CASH` order. | `{ paymentType: 'CASH' }` |
| `PAYMENT_EXCEEDS_OWED` | 409 | Payment `amount` > current order `owed`. | `{ owed, amount }` |
| `PAYMENT_DATE_BEFORE_ORDER_DATE` | 400 | Payment `date` < order `date`. | `{ orderDate }` |
| `LEDGER_ENTRY_NOT_FOUND` | 404 | Ledger entry id does not exist. | `{ ledgerEntryId }` |
| `LEDGER_ENTRY_NOT_REVERSIBLE` | 409 | Reverse requested on anything other than a `PAYMENT` with `source = MANUAL`. | `{ type, source }` |
| `LEDGER_ENTRY_ALREADY_REVERSED` | 409 | The manual payment already has a `PAYMENT_REVERSAL`. | `{ ledgerEntryId }` |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Idempotent endpoint called without `Idempotency-Key`. | — |
| `IDEMPOTENCY_KEY_INVALID` | 400 | Header does not match `^[A-Za-z0-9_-]{16,100}$`. | — |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same (user, key) already stored with a different request hash. | — |

Evaluation order inside one request is fixed: CSRF → authentication → password-change gate → permission → idempotency header format → schema validation → idempotent replay lookup → service checks in the order each endpoint lists them. The first failure wins; only `VALIDATION_FAILED` aggregates multiple problems.

### 6.4 Guard pipeline and permission declarations

#### 6.4.1 Global pipeline (registered in `AppModule` in this order)

| # | Component | File | Behaviour |
|---|---|---|---|
| 1 | `pino-http` request logger | `apps/api/src/common/logging/logger.module.ts` | Assigns `X-Request-Id`; logs method, route, status, duration, userId; never logs bodies, `Authorization`, `Cookie`, `Set-Cookie`. |
| 2 | `AppThrottlerGuard` (extends `ThrottlerGuard`) | `apps/api/src/common/guards/app-throttler.guard.ts` | Named throttlers of 6.8.8. |
| 3 | `CsrfGuard` | `common/guards/csrf.guard.ts` | 6.1.2 header rule for `POST/PUT/PATCH/DELETE`. |
| 4 | `AuthGuard` | `common/guards/auth.guard.ts` | Skips `@Public()`. Verifies the JWT with `JwtService` (`HS256` only, secret `JWT_ACCESS_SECRET`, no clock tolerance), loads `users` + `user_permissions` by `sub` in one query, rejects per `AUTH_*` codes, attaches `req.auth: AuthContext` and puts the user id into the request context. |
| 5 | `PasswordChangeGuard` | `common/guards/password-change.guard.ts` | 6.8.7. |
| 6 | `PermissionGuard` | `common/guards/permission.guard.ts` | Admin passes every check. Employee: `@AdminOnly()` → `ADMIN_ONLY`; `@RequirePermission(...keys)` → every key required; `@RequireAnyPermission(...keys)` → at least one key; `@Authenticated()` and `@Public()` → pass. |
| 7 | `ZodValidationPipe` | `common/pipes/zod-validation.pipe.ts` | Applied per parameter: `@Body(new ZodValidationPipe(OrderCreateBody))`, `@Query(new ZodValidationPipe(OrderListQuery))`, `@Param('id', new ZodValidationPipe(IdParam))`. |
| 8 | `ApiExceptionFilter` | `common/filters/api-exception.filter.ts` | 6.3.1. |

```ts
interface AuthContext {
  userId: number;
  username: string;
  role: Role;
  isAdmin: boolean;
  mustChangePassword: boolean;
  permissions: ReadonlySet<PermissionKey>;   // admin: every PERMISSION_KEYS entry; employee: stored grantable keys
  canViewCost: boolean;                      // isAdmin || permissions.has('items.viewCost')
  ip: string;                                // req.ip (trust proxy = 172.28.0.0/24)
  requestId: string;
}
```

#### 6.4.2 Declarations and the startup check

Every controller handler carries **exactly one** of these decorators (`apps/api/src/common/decorators/access.decorators.ts`), all writing the metadata key `pallet:access`:

| Decorator | Meaning |
|---|---|
| `@Public()` | No authentication. Used only by `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/uploads/:fileName`, `GET /api/health`. |
| `@Authenticated()` | Any active, logged-in user. |
| `@AdminOnly()` | Role `ADMIN`. |
| `@RequirePermission(...keys: GrantablePermissionKey[])` | All listed keys. |
| `@RequireAnyPermission(...keys: GrantablePermissionKey[])` | At least one listed key. |

`PermissionDeclarationCheck` (`apps/api/src/common/checks/permission-declaration.check.ts`) implements `OnApplicationBootstrap`: it enumerates every controller and handler via `DiscoveryService` + `MetadataScanner`, reads `pallet:access` with `Reflector`, and throws `Error('Routes without access declaration: GET /api/x, …')` if any handler has zero or more than one declaration, declares a permission rule with an empty key list, or declares a key that is not in `GRANTABLE_PERMISSION_KEYS`. (`RequirePermission` / `RequireAnyPermission` also take a non-empty tuple, so the empty case is normally a compile error.) The process exits with code 1. The unit test `apps/api/src/common/checks/permission-declaration.check.test.ts` compiles `AppModule` with `Test.createTestingModule` and calls `app.init()` so CI fails on a missing declaration. The same check builds the route→permission table printed at `debug` level on startup; the test also asserts that every key of `GRANTABLE_PERMISSION_KEYS` appears in at least one declaration.

### 6.5 Optimistic locking

- Versioned rows: `users`, `factory_settings`, `items`, `purchase_batches`, `customers`, `drivers`, `orders`. Every row starts at `version = 1`.
- The client sends the `version` it last read: in the body for `PATCH`/`PUT`/`POST …/cancel`, and as `?version=N` for `DELETE`.
- The service takes the row lock (6.6), then compares; mismatch → 409 `VERSION_CONFLICT` `{ currentVersion }`. The web app shows "This record was changed by someone else" with a Reload action (re-fetches, keeps nothing).
- A successful user edit sets `version = version + 1` in the same `UPDATE`.
- `version` changes on user-initiated edits of that row: item fields/archive, batch edit/delete, customer fields/archive, driver fields/archive, user displayName/role/isActive/permissions/password reset, settings update, order header/lines edit and cancel. In addition (Q30), `orders.version` increments on **every** operation that touches the order after creation — return create/replace/delete and manual payment create/reverse — through `recomputeOrder(tx, orderId, { bumpVersion: true })` (§4.6); only order creation uses `bumpVersion: false`. Stock movements never bump `items.version` (an open item form does not conflict because an order moved its stock). An open order edit form therefore receives `VERSION_CONFLICT` after a return or payment was recorded and reloads; the mutation responses (`ReturnResultDto`, `PaymentResultDto`, `OrderDetailDto`) carry the new `version`.
- Returns and ledger entries are never updated and carry no `version`; their reversal is guarded by "not already reversed", checked under the order lock.

### 6.6 Transactions and lock order

Every mutating endpoint runs in one interactive Prisma transaction created by `runInTransaction(fn)` (`apps/api/src/prisma/transaction.ts`): `prisma.$transaction(fn, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 })`. `SERIALIZABLE` is never used. Locks are taken with helpers in `apps/api/src/prisma/locks.ts` that use `tx.$queryRaw` tagged templates only:

```ts
lockCustomer(tx, id)      // SELECT id FROM customers WHERE id = ${id} FOR UPDATE
lockOrder(tx, id)         // SELECT id FROM orders WHERE id = ${id} FOR UPDATE
lockItems(tx, ids)        // SELECT id FROM items WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE   (ids de-duplicated)
lockOrderCounter(tx)      // SELECT last_number FROM order_counter WHERE id = 1 FOR UPDATE
lockBatch(tx, id)         // SELECT id FROM purchase_batches WHERE id = ${id} FOR UPDATE
lockDriver(tx, id)        // SELECT id FROM drivers WHERE id = ${id} FOR UPDATE
lockUser(tx, id)          // SELECT id FROM users WHERE id = ${id} FOR UPDATE
lockActiveAdmins(tx)      // SELECT id FROM users WHERE role = 'ADMIN' AND is_active ORDER BY id FOR UPDATE
lockSettings(tx)          // SELECT id FROM factory_settings WHERE id = 1 FOR UPDATE
lockSessionFamily(tx, id) // SELECT id FROM session_families WHERE id = ${id}::uuid FOR UPDATE
```

The global order is **customer → order → items (ascending id) → order counter**; rows outside that chain (batch, driver, user, settings, session family) are locked last and never while waiting for a chain lock. When the service must read a row to learn which parent to lock (an order's `customer_id`, a return's `order_id`, a batch's `item_id`, a ledger entry's `order_id`), it reads it without a lock first, takes the locks in order, then re-reads under lock; the referenced parent ids are immutable so the first read cannot be stale.

| Operation | Locks, in order | Checks done after the locks |
|---|---|---|
| Order create | customer → items(line item ids) → counter | customer active; items exist, active, stock; credit rule |
| Order edit | customer → order → items(old ∪ new line item ids; only when `lines` present) | version; not cancelled; activity gate; date bound; stock; credit rule |
| Order cancel | customer → order → items(line item ids) | version; not cancelled; activity gate |
| Return create | order → items(line item ids with `acceptedQuantity > 0`) | not cancelled; out quantities |
| Return replace | order → items(item ids with accepted > 0 in old ∪ new) | not reversed; out quantities after reversal; stock net |
| Return delete | order → items(item ids with accepted > 0 in the return) | not reversed; stock |
| Manual payment create | order | LENT; not cancelled; amount ≤ owed |
| Manual payment reverse | order | entry is non-reversed MANUAL PAYMENT |
| Batch create | item | item active |
| Batch edit / delete | item → batch | version; stock |
| Stock adjustment | item | stock |
| Item create (with `initialBatch`) | — (new row) | — |
| Item edit / archive | item | version; not archived |
| Customer edit / archive | customer | version; not archived; open orders (archive) |
| Driver edit / archive | driver | version; not archived |
| User update | active admins (only when `role` or `isActive` changes) → target user | version; self guards; last-admin guard |
| User permissions / reset password / logout-all | target user | version (permissions only) |
| Change own password | own user row | current password |
| Settings update | settings | version |
| Refresh | session family | 6.8.3 |

Every transaction that touches an order ends with `recomputeOrder(tx, orderId)` (reads the order's lines, all its returns with their lines, and all its ledger rows; applies `computeOrderTotals` from `@pallet/shared`; writes the maintained columns on `orders` and `order_lines`). Every transaction that writes stock movements applies one `UPDATE items SET quantity_on_hand = quantity_on_hand + ${net} WHERE id = ${id}` per item with the per-item net of that operation, after the service has verified `quantity_on_hand + net ≥ 0` (else `STOCK_INSUFFICIENT`).

### 6.7 Idempotency (order, return, payment creation)

Implemented by `IdempotencyService` (`apps/api/src/modules/idempotency/idempotency.service.ts`).

1. Header absent → 400 `IDEMPOTENCY_KEY_REQUIRED`; malformed → 400 `IDEMPOTENCY_KEY_INVALID`.
2. `requestHash = sha256hex(METHOD + ' ' + routePath + '\n' + canonicalJson(body))` where `routePath` is the concrete path (`/api/orders/12/returns`) and `canonicalJson` serialises the **validated** body with object keys sorted recursively and no whitespace.
3. Look up `idempotency_keys` by `(user_id, key)`.
   - Found, `expires_at > now()`, same `request_hash` → return the stored `response_status` + `response_body` verbatim with header `Idempotency-Replayed: true`. No other work is done.
   - Found, not expired, different hash → 409 `IDEMPOTENCY_KEY_REUSED`.
   - Found and expired → delete it, continue as not found.
4. Run the creation transaction. Its **last** statement inserts `idempotency_keys(user_id, key, scope, request_hash, response_status = 201, response_body = <the exact JSON returned>, expires_at = now() + interval '24 hours')`.
5. A unique violation on `(user_id, key)` during that insert (a concurrent duplicate committed first) rolls the whole transaction back; the service repeats step 3 once and returns its result.
6. Any error before commit (validation, `CREDIT_LIMIT_EXCEEDED`, `STOCK_INSUFFICIENT`) stores nothing, so the same key can be re-submitted — this is how the admin override re-submit (same key, body now with `confirmCreditOverride: true`) succeeds.
7. `MaintenanceService` deletes rows with `expires_at < now()` every hour.

`scope` values: `ORDER_CREATE`, `RETURN_CREATE`, `PAYMENT_CREATE`. The web app generates one `crypto.randomUUID()` per form instance, reuses it for every retry of the same submission (network error, override confirmation), and generates a new one after a success or when the form is reset.

### 6.8 Authentication flow

#### 6.8.1 Cookie

| Attribute | Value |
|---|---|
| Name | `pallet_rt` |
| Value | 32 random bytes (`crypto.randomBytes(32)`), base64url, 43 characters |
| Stored | `refresh_tokens.token_hash = sha256hex(value)` only |
| `HttpOnly` | yes |
| `Secure` | `COOKIE_SECURE` (`true` in production; `false` only in local development over http) |
| `SameSite` | `Strict` |
| `Path` | `/api/auth` |
| `Max-Age` | seconds until the token's `expires_at` |
| Clear | same name/path/attributes with `Max-Age=0` and empty value |

Token lifetime: `expires_at = min(now + 14 days, family.absolute_expires_at)`; `family.absolute_expires_at = family.created_at + 30 days` (sliding 14 days, absolute 30 days).

#### 6.8.2 Login (`POST /api/auth/login`)

1. Throttlers `global` and `login` apply. CSRF header required.
2. Validate `LoginBody`. `username` is trimmed and lower-cased.
3. In a transaction, read `login_throttles` for `(req.ip, username)` `FOR UPDATE` (insert-if-absent with `ON CONFLICT DO NOTHING` first so the row exists to lock). If `locked_until > now()`: run one `argon2.verify(DUMMY_HASH, password)`, write audit `LOGIN_FAILURE` (`userId` of the matching user or `null`, `usernameAttempt`, `summaryParams.reason = 'LOCKED'`), commit, return 401 `AUTH_INVALID_CREDENTIALS`.
4. Lock the account row by `username` (`SELECT id FROM users WHERE username = $1 FOR UPDATE` — the same statement whether or not it exists) and load the user, so a password reset or change committing meanwhile cannot be overtaken: an unlocked read would let the old password open a session issued after the `token_version` bump. If none, or `is_active = false`: run `argon2.verify(DUMMY_HASH, password)` (the real hash is not verified for inactive users). Otherwise `argon2.verify(user.password_hash, password)`. Exactly one verification runs on every path. `DUMMY_HASH` is computed at startup from 32 random bytes with the production parameters.
5. Failure: if `now() − window_started_at > 15 min` set `failure_count = 1, window_started_at = now()`, else `failure_count += 1`. If `failure_count ≥ 5`: `locked_until = now() + min(15 min, 1 min × 2^lockout_count)`, `lockout_count += 1`, `failure_count = 0`, `window_started_at = now()`, audit `LOCKOUT`. Always audit `LOGIN_FAILURE` (`summaryParams.reason = 'INVALID'`). Commit. Return 401 `AUTH_INVALID_CREDENTIALS`. Lock durations therefore go 1, 2, 4, 8, 15, 15 … minutes.
6. Success: delete the `login_throttles` row; if `argon2.needsRehash(hash, params)` store a fresh hash; set `last_login_at = now()`; insert a `session_families` row (`absolute_expires_at = now() + 30 d`, `created_ip = req.ip`, `user_agent` truncated to 255) and an `ACTIVE` `refresh_tokens` row; audit `LOGIN_SUCCESS` (entity `SESSION`, entity id = family id); commit.
7. Respond 200 `AuthTokenDto`, `Set-Cookie: pallet_rt=<value>`.

Lockout is never keyed on username alone. `MaintenanceService` deletes `login_throttles` rows whose `updated_at` is older than 24 hours (this also resets `lockout_count`). Once a day it also deletes `session_families` whose `absolute_expires_at` is more than 30 days in the past (their `refresh_tokens` rows go with them through `ON DELETE CASCADE`); audit rows about those sessions stay.

#### 6.8.3 Refresh (`POST /api/auth/refresh`) — rotation with grace window

Throttlers `global` and `refresh`. CSRF header required. No body (an empty JSON object `{}` is accepted). Let P be the token in the `pallet_rt` cookie.

1. Cookie absent, or `sha256hex(P)` matches no row → 401 `AUTH_REFRESH_INVALID`, clear cookie.
2. Lock the token's family (`lockSessionFamily`) and re-read the family, its user and P under the lock. If `family.revoked_at` is set, or `now() ≥ family.absolute_expires_at`, or `now() ≥ P.expires_at` → 401 `AUTH_REFRESH_INVALID`, clear cookie. If the user is inactive → revoke the family (`USER_DEACTIVATED`), 401, clear cookie.
3. **Normal rotation** — `P.status = 'ACTIVE'`: set P `status = 'ROTATED', rotated_at = now()`; insert new token N (`ACTIVE`); `family.last_used_at = now()`.
4. **Grace rotation** — `P.status = 'ROTATED'` **and** P is the family's most recently rotated `ROTATED` token (`max(rotated_at)` among `ROTATED` tokens) **and** `now() − P.rotated_at ≤ 30 s`: set the family's current `ACTIVE` token to `status = 'RETIRED', rotated_at = now()`; insert new token N (`ACTIVE`). P is unchanged, so it remains the "immediately previous" token and its 30-second window is measured from its original rotation and never extended. No reuse detection.
5. **Reuse** — anything else (an older `ROTATED` token, P after the 30-second window, a `RETIRED` or `REVOKED` token): set `family.revoked_at = now()`, `revoked_reason = 'REUSE_DETECTED'`, every token of the family `status = 'REVOKED'`; audit `SESSION_REUSE_DETECTED` (entity `SESSION`, id = family id, `summaryParams.ip`); commit; 401 `AUTH_REFRESH_INVALID`; clear cookie.
6. On 3 or 4: commit, respond 200 `AuthTokenDto` with a new access token and `Set-Cookie` for N.

The partial unique index `refresh_tokens_one_active_per_family` guarantees one `ACTIVE` token per family. The grace rule covers two tabs refreshing at once, a new tab opened for the receipt, and a lost response retried by the client.

#### 6.8.4 Logout (`POST /api/auth/logout`) and logout everywhere

- Logout (this device): Public; if the cookie maps to a token, lock its family and revoke it (`revoked_reason = 'LOGOUT'`, all its tokens `REVOKED`), audit `LOGOUT` (entity `SESSION`). Always clear the cookie and respond 204, also when the cookie is absent or unknown.
- `POST /api/auth/logout-all` (self) and `POST /api/users/:id/logout-all` (admin): revoke every non-revoked family of the user (`LOGOUT_ALL`), `users.token_version += 1`, audit `LOGOUT_ALL` (entity `USER`). Self variant also clears the cookie. Respond 204. Existing access tokens fail on their next request with `AUTH_TOKEN_INVALID`.

#### 6.8.5 Server-side revocation triggers

| Event | Families revoked with reason | `token_version` | Notes |
|---|---|---|---|
| User deactivated | `USER_DEACTIVATED` | +1 | — |
| Admin resets password | `PASSWORD_RESET` | +1 | `must_change_password = true` |
| User changes own password | `PASSWORD_CHANGED` | +1 | then a new family is issued in the same response |
| Logout everywhere | `LOGOUT_ALL` | +1 | — |
| Role or permission change | none | unchanged | effective on the next request because permissions are read from the database per request |

#### 6.8.6 Change own password (`POST /api/auth/change-password`)

1. `@Authenticated()`; allowed while `mustChangePassword` is true; throttlers `global` and `login`.
2. Lock own user row. `argon2.verify(currentHash, currentPassword)` fails → 400 `CURRENT_PASSWORD_INCORRECT`.
3. `checkPasswordPolicy(newPassword, username)` (`apps/api/src/modules/auth/password-policy.ts`) returns the first failing code in this order: `PASSWORD_TOO_SHORT` (< 10 code points), `PASSWORD_TOO_LONG` (> 128), `PASSWORD_TOO_COMMON` (lower-cased value in the bundled list, or equal to the username case-insensitively).
4. `argon2.verify(currentHash, newPassword)` succeeds → 400 `PASSWORD_SAME_AS_CURRENT`.
5. Store `argon2.hash(newPassword, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })`, `must_change_password = false`, `token_version += 1`; revoke all families (`PASSWORD_CHANGED`); create a new family + `ACTIVE` token; audit `PASSWORD_CHANGE`; commit.
6. Respond 200 `AuthTokenDto` (access token carries the new `tv`) with `Set-Cookie` for the new token, so the current tab stays signed in.

#### 6.8.7 Must-change-password gate

While `users.must_change_password = true`, `PasswordChangeGuard` returns 403 `PASSWORD_CHANGE_REQUIRED` for every endpoint except: `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/logout`, `POST /api/auth/logout-all`, `POST /api/auth/refresh` (and the Public endpoints, which carry no user). The web app redirects to `/change-password` whenever `MeDto.mustChangePassword` is true or it receives this code.

#### 6.8.8 Throttling

`ThrottlerModule.forRoot({ throttlers: [...], errorMessage: 'RATE_LIMITED' })` with in-memory storage (single API instance). `AppThrottlerGuard` overrides `throwThrottlingException` to throw `ApiError('RATE_LIMITED', { retryAfterSeconds })` and sets `Retry-After`.

| Name | Limit | Window | Tracker | Applies to (`skipIf` returns true elsewhere) |
|---|---|---|---|---|
| `global` | 600 | 60 s | `req.ip` | every route except `GET /api/health` and `GET /api/uploads/:fileName` (`@SkipThrottle({ global: true })`) |
| `login` | 60 | 60 s | `req.ip` | `POST /api/auth/login`, `POST /api/auth/change-password` |
| `refresh` | 60 | 60 s | `req.ip` | `POST /api/auth/refresh` |
| `upload` | 10 | 60 s | `req.auth.userId` | `POST /api/uploads` — enforced by the route guard `UploadThrottleGuard` in the same storage: the user is known only after `AuthGuard`, which runs after the global throttler |

`req.ip` is the real client address because Express `trust proxy` is set to `172.28.0.0/24` (the pinned compose subnet) and Caddy writes `X-Forwarded-For`. Route matching for `skipIf` uses the handler metadata key `pallet:throttle` set by `@ThrottleScope('login' | 'refresh')`; the per-user `upload` limit is `UploadThrottleGuard`.

### 6.9 DTO definitions (`packages/shared/src/schemas/dto.ts`)

Fields marked **[cost]** are present only when `AuthContext.canViewCost` is true; otherwise the property is **omitted** (not `null`). Mapper functions (`apps/api/src/modules/<module>/<module>.mapper.ts`) take `(row, ctx: { canViewCost: boolean })` and are the only way a response object is built; controllers never return Prisma rows.

```ts
// ── generic ──
interface PageDto<T> { items: T[]; page: number; pageSize: number; total: number }
interface UserRefDto { id: number; username: string; displayName: string }
interface CustomerRefDto { id: number; name: string; phone: string; archived: boolean }
interface DriverRefDto { id: number; name: string; phone: string; carNumber: string; archived: boolean }
interface ItemRefDto { id: number; name: string; imageUrl: string | null; archived: boolean }
// imageUrl / logoUrl = '/api/uploads/' + uploads.file_name, or null

// ── auth / users ──
interface MeDto {
  id: number; username: string; displayName: string; role: Role;
  mustChangePassword: boolean;
  permissions: PermissionKey[];      // admin: all PERMISSION_KEYS; employee: stored keys; sorted ascending
}
interface AuthTokenDto { accessToken: string; accessTokenExpiresAt: string; user: MeDto }
interface UserListItemDto {
  id: number; username: string; displayName: string; role: Role; isActive: boolean;
  mustChangePassword: boolean; lastLoginAt: string | null; version: number;
}
interface UserDto extends UserListItemDto {
  permissions: GrantablePermissionKey[];   // employee: stored keys sorted; admin: []
  activeSessionCount: number;              // non-revoked, non-expired families
  createdAt: string; updatedAt: string;
}

// ── settings / uploads ──
interface SettingsDto {
  factoryName: string; phone: string; address: string;
  logoUploadId: number | null; logoUrl: string | null;
  version: number; updatedAt: string;
}
interface UploadDto { id: number; kind: UploadKind; url: string; width: number; height: number }

// ── items / stock / batches ──
interface ItemDto {
  id: number; name: string; imageUploadId: number | null; imageUrl: string | null;
  depositPrice: number; quantityOnHand: number; minStock: number | null;
  isLowStock: boolean;              // minStock !== null && quantityOnHand <= minStock
  quantityOut: number;              // Σ order_lines.out_quantity over non-cancelled orders
  damagedTotal: number;             // Σ return_lines.damaged_quantity over non-reversed returns of non-cancelled orders
  archivedAt: string | null; version: number; createdAt: string; updatedAt: string;
}
interface StockMovementDto {
  id: number; itemId: number; quantity: number; reason: StockMovementReason;
  batchId: number | null; orderId: number | null; orderNumber: number | null; returnId: number | null;
  note: string | null;
  balanceAfter: number;             // SUM(quantity) OVER (PARTITION BY item_id ORDER BY id)
  createdAt: string; createdBy: UserRefDto;
}
interface PurchaseBatchDto {
  id: number; itemId: number; itemName: string; date: string; quantity: number;
  unitCost?: number;   // [cost]
  totalCost?: number;  // [cost]
  note: string | null; version: number; createdAt: string; updatedAt: string; createdBy: UserRefDto;
}

// ── customers / drivers ──
interface CustomerSummaryDto {
  palletsOut: number; outValue: number; owed: number; held: number; compensation: number;
  creditLimit: number | null;
  headroom: number | null;          // creditLimit − outValue (negative after an admin override); null = no limit
  openOrderCount: number;
}
interface CustomerDto {
  id: number; name: string; phone: string; altPhone: string | null; address: string;
  creditLimit: number | null; archivedAt: string | null; version: number;
  createdAt: string; updatedAt: string;
  summary: CustomerSummaryDto;
}
interface CustomerHoldingDto {
  item: ItemRefDto; quantityOut: number; outValue: number;
  sources: { orderId: number; orderNumber: number; orderDate: string; quantityOut: number; unitDeposit: number }[];
  // sources: non-cancelled orders with out_quantity > 0 for this item, ordered by orderDate asc, orderNumber asc
}
interface CustomerDetailDto extends CustomerDto {
  holdings: CustomerHoldingDto[];   // ordered by item name asc
  palletsOutByItem: { itemId: number; itemName: string; quantityOut: number }[];
}
type CustomerHistoryItemDto =
  | { kind: 'HANDOVER'; date: string; createdAt: string; orderId: number; orderNumber: number;
      paymentType: PaymentType; status: OrderStatus; cancelled: boolean; driver: DriverRefDto;
      lines: { item: ItemRefDto; quantity: number; unitDeposit: number; lineTotal: number }[];
      quantityTotal: number; depositTotal: number }
  | { kind: 'RETURN'; date: string; createdAt: string; returnId: number; orderId: number; orderNumber: number;
      reversed: boolean; reversalKind: ReturnReversalKind | null; replacedByReturnId: number | null;
      lines: { item: ItemRefDto; acceptedQuantity: number; damagedQuantity: number; damagedRefund: number }[];
      acceptedTotal: number; damagedTotal: number; refundDue: number; cashRefund: number }
  | { kind: 'LEDGER'; date: string /* effective date */; createdAt: string; ledgerEntryId: number;
      orderId: number; orderNumber: number; type: LedgerEntryType; source: LedgerEntrySource;
      amount: number; isAutomatic: boolean; reversesEntryId: number | null; note: string | null };
interface DriverDto {
  id: number; name: string; phone: string; carNumber: string; archivedAt: string | null;
  version: number; createdAt: string; updatedAt: string;
}

// ── orders / returns / ledger ──
interface OrderListItemDto {
  id: number; orderNumber: number; date: string; paymentType: PaymentType; status: OrderStatus;
  customer: CustomerRefDto; driver: DriverRefDto;
  depositTotal: number; owed: number; outValue: number; held: number; outQuantityTotal: number;
  createdAt: string;
}
interface OrderLineDto {
  id: number; item: ItemRefDto; quantity: number; unitDeposit: number; lineTotal: number;
  returnedAccepted: number; returnedDamaged: number; outQuantity: number;
}
interface ReturnLineDto {
  id: number; orderLineId: number; item: ItemRefDto;
  acceptedQuantity: number; damagedQuantity: number; unitDeposit: number; damagedRefund: number;
  compensation: number;             // damagedQuantity × unitDeposit − damagedRefund
}
interface ReturnDto {
  id: number; orderId: number; orderNumber: number; date: string; notes: string | null;
  refundDue: number; owedBefore: number; cashRefund: number;
  lines: ReturnLineDto[];
  reversed: boolean; reversedAt: string | null; reversedBy: UserRefDto | null;
  reversalKind: ReturnReversalKind | null;
  replacedByReturnId: number | null; replacesReturnId: number | null;
  canReverse: boolean;              // !reversed (permission-independent)
  createdAt: string; createdBy: UserRefDto;
}
interface LedgerEntryDto {
  id: number; orderId: number; orderNumber: number; customer: CustomerRefDto;
  type: LedgerEntryType; source: LedgerEntrySource; amount: number;
  date: string | null;              // stored business date (null only for the automatic hand-over payment)
  effectiveDate: string;            // COALESCE(date, orders.date)
  isAutomatic: boolean; returnId: number | null;
  reversesEntryId: number | null; reversedByEntryId: number | null; isReversed: boolean;
  canReverse: boolean;              // type = PAYMENT && source = MANUAL && !isReversed (permission-independent)
  note: string | null; createdAt: string; createdBy: UserRefDto;
}
interface OrderDetailDto extends OrderListItemDto {
  notes: string | null;
  paymentsNet: number; creditsTotal: number; refundsNet: number; compensation: number;
  cancelledAt: string | null; cancelledBy: UserRefDto | null;
  creditOverride: { by: UserRefDto; at: string } | null;
  lines: OrderLineDto[];            // by order_lines.id asc
  returns: ReturnDto[];             // all returns incl. reversed, by id asc
  ledgerEntries: LedgerEntryDto[];  // all rows incl. reversals, by id asc (= recording order)
  canEditLines: boolean;            // !cancelled && no non-reversed return && no non-reversed MANUAL payment
  canCancel: boolean;               // same condition as canEditLines
  version: number; updatedAt: string; createdBy: UserRefDto;
}
interface ReturnResultDto { returnId: number; order: OrderDetailDto }
interface PaymentResultDto { ledgerEntryId: number; order: OrderDetailDto }

// ── receipt ──
interface ReceiptLineDto { itemName: string; quantity: number; unitDeposit: number; lineTotal: number }
interface ReceiptSheetDto {
  sheetNumber: number;              // 1-based
  sheetCount: number;
  lines: ReceiptLineDto[];          // ≤ RECEIPT_LINES_PER_HALF (6)
  showTotal: boolean;               // true only on the last sheet
}
interface ReceiptDto {
  orderId: number; orderNumber: number; orderNumberDisplay: string;   // zero-padded to 6 digits
  date: string; paymentType: PaymentType; depositTotal: number;
  factory: { name: string; phone: string; address: string; logoUrl: string | null };
  customer: { name: string; phone: string; altPhone: string | null; address: string };
  driver: { name: string; phone: string; carNumber: string };
  linesPerHalf: number;             // RECEIPT_LINES_PER_HALF
  sheets: ReceiptSheetDto[];        // chunkReceiptLines(lines) — one sheet per chunk; each A4 sheet prints its chunk twice
}

// ── dashboard ──
type ActivityEventKind = 'HANDOVER' | 'CANCELLATION' | 'RETURN' | 'PAYMENT' | 'REFUND';
interface ActivityEventDto {
  kind: ActivityEventKind; at: string /* createdAt or cancelledAt */; date: string /* business date */;
  orderId: number; orderNumber: number; customer: CustomerRefDto;
  quantity: number | null;          // HANDOVER: Σ line quantity; RETURN: accepted + damaged; else null
  amount: number | null;            // HANDOVER: depositTotal; RETURN: refundDue; PAYMENT/REFUND: amount; CANCELLATION: null
  reversed: boolean;                // RETURN: return reversed; PAYMENT/REFUND: row reversed; else false
}
interface DashboardDto {
  positions?: { palletsOut: number; outValue: number; owed: number; held: number;
                openOrderCount: number; customersWithOpenOrders: number };           // needs reports.viewPositions
  lowStock?: { count: number;
               items: { id: number; name: string; imageUrl: string | null; quantityOnHand: number; minStock: number }[] }; // needs items.view
  recentActivity?: ActivityEventDto[];                                                // needs orders.view; latest 10
}

// ── reports ──
interface PositionsReportDto {
  generatedAt: string;
  columns: ItemRefDto[];            // items with Σ out > 0 across the included rows, by name asc
  rows: { customer: CustomerRefDto;
          palletsOutByItem: { itemId: number; quantityOut: number }[];   // one entry per column, 0 allowed
          palletsOut: number; outValue: number; owed: number; held: number }[];
  totals: { palletsOutByItem: { itemId: number; quantityOut: number }[];
            palletsOut: number; outValue: number; owed: number; held: number };
}
interface PurchasesReportDto {      // every money field here is cost data; the endpoint refuses without items.viewCost
  generatedAt: string; dateFrom: string; dateTo: string;
  truncated: boolean;               // over 5,000 rows (§12.1); totals stay complete
  rows: { batchId: number; item: ItemRefDto; date: string; quantity: number; unitCost: number;
          totalCost: number; note: string | null }[];                    // date asc, id asc
  perItem: { item: ItemRefDto; batchCount: number; quantity: number; totalCost: number }[];   // item name asc
  totals: { batchCount: number; quantity: number; totalCost: number };
}
interface ActivityReportDto {
  generatedAt: string; dateFrom: string; dateTo: string;
  truncated: boolean;               // a section over 5,000 rows (§12.1); totals stay complete
  filters: { customerId: number | null; itemId: number | null; driverId: number | null };
  moneyOmitted: boolean;            // true when itemId is set (payments/refunds are per order, not per item)
  handovers: { orderId: number; orderNumber: number; date: string; customer: CustomerRefDto;
               driver: DriverRefDto; paymentType: PaymentType;
               lines: { item: ItemRefDto; quantity: number; unitDeposit: number; lineTotal: number }[];
               quantity: number; depositTotal: number }[];
  returns: { returnId: number; orderId: number; orderNumber: number; date: string; customer: CustomerRefDto;
             lines: { item: ItemRefDto; acceptedQuantity: number; damagedQuantity: number;
                      damagedRefund: number; compensation: number }[];
             acceptedQuantity: number; damagedQuantity: number; refundDue: number; cashRefund: number }[];
  payments: LedgerEntryDto[];       // PAYMENT and PAYMENT_REVERSAL rows (reversals listed as their own rows); [] when moneyOmitted
  refunds: LedgerEntryDto[];        // REFUND and REFUND_REVERSAL rows; [] when moneyOmitted
  compensation: { returnId: number; orderNumber: number; date: string; customer: CustomerRefDto;
                  item: ItemRefDto; damagedQuantity: number; unitDeposit: number;
                  damagedRefund: number; compensation: number }[];
  totals: {
    handoverQuantity: number; handoverDepositTotal: number;
    returnedAccepted: number; returnedDamaged: number; refundDueTotal: number;
    paymentsGross: number; paymentReversals: number; paymentsNet: number;       // 0 when moneyOmitted
    refundsGross: number; refundReversals: number; refundsNet: number;          // 0 when moneyOmitted
    compensationAssessed: number;
  };
}
interface StockReportDto {
  generatedAt: string;
  rows: { item: ItemRefDto; quantityOnHand: number; quantityOut: number; damagedTotal: number;
          minStock: number | null; isLowStock: boolean }[];
  totals: { quantityOnHand: number; quantityOut: number; damagedTotal: number; lowStockCount: number };
}

// ── audit ──
interface AuditLogDto {
  id: number; createdAt: string;
  user: UserRefDto | null; usernameAttempt: string | null;
  action: AuditAction; entityType: AuditEntityType; entityId: string | null;
  summaryKey: string;               // i18n key audit.summary.<entityType>.<action>
  summaryParams: Record<string, string | number>;   // never contains cost values
  ip: string | null; requestId: string | null;
  before: unknown | null; after: unknown | null;    // redacted per section 11 for viewers without items.viewCost
}

// ── health ──
interface HealthDto { status: 'ok'; db: 'ok'; version: string }
```

### 6.10 Endpoint template

Every endpoint block below lists, in this order: **Access** (the decorator of 6.4.2 and extra service-level checks), **Request** (path params, query schema, body schema — all strict), **Steps** (the exact order of checks and writes inside the transaction), **Writes** (stock movements, ledger rows, audit rows), **Response**, **Errors** (every code the endpoint can raise besides the pipeline codes `CSRF_HEADER_MISSING`, `AUTH_*`, `PASSWORD_CHANGE_REQUIRED`, `PERMISSION_DENIED`, `ADMIN_ONLY`, `VALIDATION_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`, which apply wherever their guard applies).

Audit rows are written through `AuditService.record(tx, entry)` inside the same transaction. `summaryKey` is always `audit.summary.<entityType>.<action>`; the `summaryParams` keys are listed per endpoint and never include `unitCost` or `totalCost`. Redaction of `before`/`after` is defined in section 11.

### 6.11 Auth endpoints (`apps/api/src/modules/auth/auth.controller.ts`)

#### `POST /api/auth/login`
- **Access:** `@Public()`; throttlers `global`, `login`.
- **Body:** `LoginBody = z.strictObject({ username: z.string().trim().toLowerCase().min(1).max(64), password: z.string().min(1).max(1024) })`. The username is not matched against the username pattern here, so invalid usernames take the same path as unknown ones.
- **Steps:** 6.8.2.
- **Writes:** audit `LOGIN_SUCCESS` (entity `SESSION`, params `{ username }`) or `LOGIN_FAILURE` (entity `USER`, `entityId` = user id or `null`, `usernameAttempt`, params `{ reason: 'INVALID' | 'LOCKED' }`) and `LOCKOUT` (entity `USER`, params `{ lockedMinutes }`).
- **Response:** 200 `AuthTokenDto` + `Set-Cookie`.
- **Errors:** `AUTH_INVALID_CREDENTIALS`.

#### `POST /api/auth/refresh`
- **Access:** `@Public()` (cookie-authenticated); throttlers `global`, `refresh`.
- **Body:** none, or `{}` (`RefreshBody = z.strictObject({})`).
- **Steps:** 6.8.3.
- **Writes:** audit `SESSION_REUSE_DETECTED` only on reuse.
- **Response:** 200 `AuthTokenDto` + `Set-Cookie`.
- **Errors:** `AUTH_REFRESH_INVALID` (cookie cleared).

#### `POST /api/auth/logout`
- **Access:** `@Public()` (cookie).
- **Body:** none or `{}`.
- **Steps:** 6.8.4.
- **Writes:** audit `LOGOUT` (entity `SESSION`) when a family was revoked.
- **Response:** 204, cookie cleared.
- **Errors:** none.

#### `POST /api/auth/logout-all`
- **Access:** `@Authenticated()` (allowed while `mustChangePassword`).
- **Body:** none or `{}`.
- **Steps:** lock own user row; revoke all non-revoked families (`LOGOUT_ALL`); `token_version += 1`.
- **Writes:** audit `LOGOUT_ALL` (entity `USER`, params `{ username }`).
- **Response:** 204, cookie cleared.

#### `GET /api/auth/me`
- **Access:** `@Authenticated()` (allowed while `mustChangePassword`).
- **Response:** 200 `MeDto` built from the user row loaded by `AuthGuard`.

#### `POST /api/auth/change-password`
- **Access:** `@Authenticated()` (allowed while `mustChangePassword`); throttlers `global`, `login`.
- **Body:** `ChangePasswordBody = z.strictObject({ currentPassword: z.string().min(1).max(1024), newPassword: z.string().min(1).max(1024) })`.
- **Steps:** 6.8.6.
- **Writes:** audit `PASSWORD_CHANGE` (entity `USER`, params `{ username }`).
- **Response:** 200 `AuthTokenDto` + `Set-Cookie` (new family).
- **Errors:** `CURRENT_PASSWORD_INCORRECT`, `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, `PASSWORD_TOO_COMMON`, `PASSWORD_SAME_AS_CURRENT`.

### 6.12 Users (`apps/api/src/modules/users/users.controller.ts`) — all `@AdminOnly()`

#### `GET /api/users`
- **Query:** `UserListQuery = z.strictObject({ ...PageQuery, q: SearchQuery /* username, display_name */, role: z.enum(ROLES).optional(), isActive: z.enum(['true','false','all']).default('all'), sort: sortParam(['username','displayName','createdAt','lastLoginAt'], 'username') })`.
- **Response:** 200 `PageDto<UserListItemDto>`.

#### `POST /api/users`
- **Body:**
```ts
UserCreateBody = z.strictObject({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/),
  displayName: z.string().trim().min(1).max(100),
  role: z.enum(ROLES),
  password: z.string().min(1).max(1024),          // policy checked by the service
  permissions: z.array(z.string().max(64)).max(64).default([]),
})
```
- **Steps:** (1) `checkPasswordPolicy(password, username)`; (2) permissions: if `role = 'ADMIN'` and the array is non-empty → `PERMISSIONS_ADMIN_IMPLICIT`; else validate as in `PUT /api/users/:id/permissions` steps 2–4; (3) insert user (`must_change_password = true`, `token_version = 0`, `version = 1`, Argon2id hash) and `user_permissions` rows; unique violation on `username` → `USERNAME_TAKEN`.
- **Writes:** audit `CREATE` (entity `USER`, `after = { username, displayName, role, isActive, mustChangePassword, permissions }`, params `{ username, role }`).
- **Response:** 201 `UserDto`.
- **Errors:** `USERNAME_TAKEN`, `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, `PASSWORD_TOO_COMMON`, `PERMISSIONS_ADMIN_IMPLICIT`, `PERMISSION_KEY_UNKNOWN`, `PERMISSION_NOT_GRANTABLE`, `PERMISSION_DEPENDENCY_MISSING`.

#### `GET /api/users/:id`
- **Response:** 200 `UserDto`. **Errors:** `USER_NOT_FOUND`.

#### `PATCH /api/users/:id`
- **Body:** `UserUpdateBody = z.strictObject({ version: Version, displayName: z.string().trim().min(1).max(100).optional(), role: z.enum(ROLES).optional(), isActive: z.boolean().optional() })` + at least one of the three.
- **Steps:** (1) if `role` or `isActive` is present: `lockActiveAdmins`; (2) `lockUser(target)`; not found → `USER_NOT_FOUND`; version check; (3) target = self and `isActive === false` → `SELF_DEACTIVATE_FORBIDDEN`; target = self and `role === 'EMPLOYEE'` while self is ADMIN → `SELF_DEMOTE_FORBIDDEN`; (4) target is an active ADMIN, the change removes admin power (`role → EMPLOYEE` or `isActive → false`), and the number of other active admins is 0 → `LAST_ADMIN_GUARD`; (5) apply: role ADMIN → EMPLOYEE leaves `user_permissions` empty (deleted); EMPLOYEE → ADMIN deletes stored permissions (implicit); `isActive → false` revokes all families (`USER_DEACTIVATED`) and `token_version += 1`; (6) `version += 1`.
- **Writes:** audit `UPDATE` (displayName change, before/after), `PERMISSION_CHANGE` (role change, before/after `{ role, permissions }`), `USER_DEACTIVATE` / `USER_ACTIVATE`; params `{ username }`. A body identical to the stored row changes nothing: no version bump, no audit row (Q37).
- **Response:** 200 `UserDto`.
- **Errors:** `USER_NOT_FOUND`, `VERSION_CONFLICT`, `SELF_DEACTIVATE_FORBIDDEN`, `SELF_DEMOTE_FORBIDDEN`, `LAST_ADMIN_GUARD`.

#### `PUT /api/users/:id/permissions`
- **Body:** `UserPermissionsBody = z.strictObject({ version: Version, permissions: z.array(z.string().max(64)).max(64) })`.
- **Steps:** (1) `lockUser`; not found → `USER_NOT_FOUND`; version check; target role ADMIN → `PERMISSIONS_ADMIN_IMPLICIT`; (2) strings not in `PERMISSION_KEYS` → `PERMISSION_KEY_UNKNOWN { keys }`; (3) admin-only keys → `PERMISSION_NOT_GRANTABLE { keys }`; (4) de-duplicate; `missingPermissionDependencies(keys)` non-empty → `PERMISSION_DEPENDENCY_MISSING { missing }`; (5) replace the stored set (delete + insert); `version += 1`. Sessions are not revoked; the change applies on the user's next request.
- **Writes:** audit `PERMISSION_CHANGE` (entity `USER`, before/after `{ permissions }`, params `{ username, added: n, removed: m }`).
- **Response:** 200 `UserDto`.
- **Errors:** `USER_NOT_FOUND`, `VERSION_CONFLICT`, `PERMISSIONS_ADMIN_IMPLICIT`, `PERMISSION_KEY_UNKNOWN`, `PERMISSION_NOT_GRANTABLE`, `PERMISSION_DEPENDENCY_MISSING`.

#### `POST /api/users/:id/reset-password`
- **Body:** `UserResetPasswordBody = z.strictObject({ newPassword: z.string().min(1).max(1024) })`.
- **Steps:** `lockUser`; not found → `USER_NOT_FOUND`; `checkPasswordPolicy(newPassword, target.username)`; store hash; `must_change_password = true`; `token_version += 1`; revoke all families (`PASSWORD_RESET`); `version += 1`. If the target is the calling admin, the caller's own sessions end too (the web app then shows the login page).
- **Writes:** audit `PASSWORD_RESET` (entity `USER`, params `{ username }`).
- **Response:** 204.
- **Errors:** `USER_NOT_FOUND`, `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, `PASSWORD_TOO_COMMON`.

#### `POST /api/users/:id/logout-all`
- **Steps:** `lockUser`; revoke all families (`LOGOUT_ALL`); `token_version += 1`.
- **Writes:** audit `LOGOUT_ALL` (entity `USER`, params `{ username }`).
- **Response:** 204. **Errors:** `USER_NOT_FOUND`.

### 6.13 Settings (`apps/api/src/modules/settings/settings.controller.ts`)

#### `GET /api/settings`
- **Access:** `@Authenticated()`. **Response:** 200 `SettingsDto`.

#### `PUT /api/settings`
- **Access:** `@AdminOnly()`.
- **Body:** `SettingsUpdateBody = z.strictObject({ version: Version, factoryName: z.string().trim().min(1).max(200), phone: z.string().trim().min(1).max(100), address: z.string().trim().min(1).max(300), logoUploadId: Id.nullable() })`.
- **Steps:** `lockSettings`; version check; `logoUploadId` not null → upload must exist (`UPLOAD_NOT_FOUND`) with `kind = 'FACTORY_LOGO'` (`UPLOAD_KIND_MISMATCH`); update; `version += 1`; `updated_by_user_id`. A body identical to the stored row changes nothing: no version bump, no audit row (Q36).
- **Writes:** audit `SETTINGS_CHANGE` (entity `SETTINGS`, entityId `'1'`, before/after changed fields).
- **Response:** 200 `SettingsDto`.
- **Errors:** `VERSION_CONFLICT`, `UPLOAD_NOT_FOUND`, `UPLOAD_KIND_MISMATCH`.

### 6.14 Uploads (`apps/api/src/modules/uploads/uploads.controller.ts`)

#### `POST /api/uploads`
- **Access:** `@RequireAnyPermission('items.create', 'items.edit')`; `kind = 'FACTORY_LOGO'` additionally requires role ADMIN (service → `ADMIN_ONLY`); throttlers `global`, `upload`.
- **Request:** `multipart/form-data`, exactly one file part named `file`; query `UploadCreateQuery = z.strictObject({ kind: z.enum(UPLOAD_KINDS) })`. Multer `memoryStorage()` with `limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 2 }` (Q35).
- **Steps:** (1) Multer `LIMIT_FILE_SIZE` → `UPLOAD_TOO_LARGE`; no file → `UPLOAD_MISSING_FILE`; (2) magic bytes: PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, WebP `52 49 46 46 ?? ?? ?? ?? 57 45 42 50`; none match → `UPLOAD_TYPE_NOT_ALLOWED` (the client `Content-Type` and file name are ignored); (3) `sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'error' })`, `metadata()` failure → `UPLOAD_INVALID_IMAGE`, and a `format` outside `png`/`jpeg`/`webp` → `UPLOAD_TYPE_NOT_ALLOWED` (Q35); (4) re-encode: `.rotate().resize({ width: W, height: W, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 })` with `W = 1600` for `ITEM_IMAGE`, `W = 800` for `FACTORY_LOGO` (Q35) (sharp drops all metadata by default; `withMetadata` is never called); (5) `fileName = randomBytes(16).toString('hex') + '.webp'`; write to `${UPLOADS_DIR}/${fileName}` with flag `wx` and mode `0o640`; (6) insert `uploads` row (`width`, `height`, `size_bytes` of the output).
- **Writes:** audit `UPLOAD_CREATE` (entity `UPLOAD`, params `{ kind, width, height }`, as §11.3).
- **Response:** 201 `UploadDto`. The upload is referenced afterwards through `imageUploadId` (items) or `logoUploadId` (settings); unreferenced uploads are kept.
- **Errors:** `UPLOAD_MISSING_FILE`, `UPLOAD_TOO_LARGE`, `UPLOAD_TYPE_NOT_ALLOWED`, `UPLOAD_INVALID_IMAGE`, `ADMIN_ONLY`.

#### `GET /api/uploads/:fileName`
- **Access:** `@Public()`; `@SkipThrottle({ global: true })`.
- **Request:** `fileName` must match `^[0-9a-f]{32}\.webp$` (else 404 `NOT_FOUND`, no validation error to avoid probing detail).
- **Response:** 200 file stream from `UPLOADS_DIR` with `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`. The path is built with `path.join(UPLOADS_DIR, fileName)` only after the regex check.
- **Errors:** `NOT_FOUND`.

### 6.15 Items (`apps/api/src/modules/items/items.controller.ts`)

Derived values on every `ItemDto` come from one query per request: `LEFT JOIN (SELECT ol.item_id, SUM(ol.out_quantity)::int AS quantity_out FROM order_lines ol JOIN orders o ON o.id = ol.order_id WHERE o.cancelled_at IS NULL GROUP BY ol.item_id)` and `LEFT JOIN (SELECT ol.item_id, SUM(rl.damaged_quantity)::int AS damaged_total FROM return_lines rl JOIN returns r ON r.id = rl.return_id AND r.reversed_at IS NULL JOIN order_lines ol ON ol.id = rl.order_line_id JOIN orders o ON o.id = ol.order_id AND o.cancelled_at IS NULL GROUP BY ol.item_id)`.

#### `GET /api/items`
- **Access:** `@RequirePermission('items.view')`.
- **Query:** `ItemListQuery = z.strictObject({ ...PageQuery, q: SearchQuery /* name */, includeArchived: BoolQuery.default(false), lowStockOnly: BoolQuery.default(false), sort: sortParam(['name','quantityOnHand','depositPrice','createdAt'], 'name') })`. `lowStockOnly=true` → `min_stock IS NOT NULL AND quantity_on_hand <= min_stock`.
- **Response:** 200 `PageDto<ItemDto>`.

#### `GET /api/items/:id`
- **Access:** `@RequirePermission('items.view')`. Archived items are returned.
- **Response:** 200 `ItemDto`. **Errors:** `ITEM_NOT_FOUND`.

#### `POST /api/items`
- **Access:** `@RequirePermission('items.create')`; `initialBatch` present additionally requires `purchases.create` (service → `PERMISSION_DENIED { required: ['purchases.create'] }`).
- **Body:**
```ts
ItemCreateBody = z.strictObject({
  name: Name200,
  depositPrice: Money,
  minStock: NonNegQuantity.nullable().default(null),
  imageUploadId: Id.nullable().default(null),
  initialBatch: z.strictObject({
    date: BusinessDate, quantity: Quantity, unitCost: Money, note: optionalText(500),
  }).optional(),
})
```
- **Steps:** (1) `imageUploadId` → exists (`UPLOAD_NOT_FOUND`), kind `ITEM_IMAGE` (`UPLOAD_KIND_MISMATCH`); (2) `initialBatch.date` ≤ today (`BUSINESS_DATE_IN_FUTURE`); `quantity × unitCost` safe; (3) insert item (`quantity_on_hand = 0`); (4) if `initialBatch`: insert batch (`total_cost = quantity × unit_cost`), movement `BATCH_ADD` `+quantity` (`batch_id`), `quantity_on_hand = quantity`.
- **Writes:** audit `CREATE` (entity `ITEM`, after = item fields + `initialBatch`, params `{ name, depositPrice, initialQuantity }` as §11.3); with a batch also `CREATE` (entity `PURCHASE_BATCH`, params `{ itemName, quantity, date }` as §11.3), in that order.
- **Response:** 201 `ItemDto`.
- **Errors:** `UPLOAD_NOT_FOUND`, `UPLOAD_KIND_MISMATCH`, `BUSINESS_DATE_IN_FUTURE`, `PERMISSION_DENIED`.

#### `PATCH /api/items/:id`
- **Access:** `@RequirePermission('items.edit')`.
- **Body:** `ItemUpdateBody = z.strictObject({ version: Version, name: Name200.optional(), depositPrice: Money.optional(), minStock: NonNegQuantity.nullable().optional(), imageUploadId: Id.nullable().optional() })` + at least one field besides `version`.
- **Steps:** `lockItems([id])`; not found → `ITEM_NOT_FOUND`; archived → `ITEM_ARCHIVED`; version check; upload checks as in create; update; `version += 1`. A `depositPrice` change never touches existing order lines.
- **Writes:** audit `UPDATE` (entity `ITEM`, before/after of changed fields, params `{ name, fields }` as §11.3); nothing at all when no field changed (Q37).
- **Response:** 200 `ItemDto`.
- **Errors:** `ITEM_NOT_FOUND`, `ITEM_ARCHIVED`, `VERSION_CONFLICT`, `UPLOAD_NOT_FOUND`, `UPLOAD_KIND_MISMATCH`.

#### `DELETE /api/items/:id?version=N`
- **Access:** `@RequirePermission('items.delete')`. Always an archive (A1).
- **Query:** `VersionQuery`.
- **Steps:** `lockItems([id])`; not found; already archived → `ITEM_ALREADY_ARCHIVED`; version check; set `archived_at = now()`, `archived_by_user_id`, `version += 1`. Stock, open lines and history are untouched.
- **Writes:** audit `DELETE` (entity `ITEM`, before/after, params `{ name }` as §11.3).
- **Response:** 200 `ItemDto`.
- **Errors:** `ITEM_NOT_FOUND`, `ITEM_ALREADY_ARCHIVED`, `VERSION_CONFLICT`.

#### `POST /api/items/:id/stock-adjustments`
- **Access:** `@RequirePermission('items.adjustStock')`.
- **Body:** `StockAdjustmentCreateBody = z.strictObject({ quantity: z.int().min(-QUANTITY_INPUT_MAX).max(QUANTITY_INPUT_MAX).refine((q) => q !== 0, { params: { code: 'too_small' } }), note: z.string().trim().min(3).max(500) })`.
- **Steps:** `lockItems([id])`; not found; `quantity_on_hand + quantity < 0` → `STOCK_INSUFFICIENT`; insert movement `MANUAL_ADJUSTMENT` (`note`); update `quantity_on_hand`. Allowed on archived items. No `version` (additive, serialised by the lock; item version unchanged).
- **Writes:** audit `STOCK_ADJUST` (entity `ITEM`, before `{ quantityOnHand }`, after `{ quantityOnHand, movement: { quantity, note } }` as §11.2, params `{ name, quantity }` as §11.3).
- **Response:** 201 `{ movement: StockMovementDto; item: ItemDto }`.
- **Errors:** `ITEM_NOT_FOUND`, `STOCK_INSUFFICIENT`.

#### `GET /api/items/:id/stock-movements`
- **Access:** `@RequirePermission('items.view')`.
- **Query:** `StockMovementListQuery = z.strictObject({ ...PageQuery, reason: z.enum(STOCK_MOVEMENT_REASONS).optional() })`; fixed order `id DESC`.
- **Response:** 200 `PageDto<StockMovementDto>`. **Errors:** `ITEM_NOT_FOUND`.

### 6.16 Purchase batches (`apps/api/src/modules/purchases/purchases.controller.ts`)

Soft-deleted batches (`deleted_at IS NOT NULL`) are invisible to every endpoint and report; their history is in the stock ledger and audit log.

#### `GET /api/purchase-batches`
- **Access:** `@RequirePermission('purchases.view')`; cost fields per `canViewCost`.
- **Query:** `PurchaseBatchListQuery = z.strictObject({ ...PageQuery, itemId: IdParam.optional(), ...dateRange, sort: sortParam(['date','quantity','createdAt'], '-date') })`. Sorting by cost is not offered.
- **Response:** 200 `PageDto<PurchaseBatchDto>`.

#### `POST /api/purchase-batches`
- **Access:** `@RequirePermission('purchases.create')` (cost is write-without-read for users lacking `items.viewCost`).
- **Body:** `PurchaseBatchCreateBody = z.strictObject({ itemId: Id, date: BusinessDate, quantity: Quantity, unitCost: Money, note: optionalText(500) })`.
- **Steps:** date ≤ today; `quantity × unitCost` safe; `lockItems([itemId])`; not found → `ITEM_NOT_FOUND`; archived → `ITEM_ARCHIVED`; insert batch (`total_cost = quantity × unit_cost`); movement `BATCH_ADD +quantity`; `quantity_on_hand += quantity`.
- **Writes:** audit `CREATE` (entity `PURCHASE_BATCH`, after includes cost fields, params `{ itemName, quantity, date }` — never cost, §11.3).
- **Response:** 201 `PurchaseBatchDto`.
- **Errors:** `ITEM_NOT_FOUND`, `ITEM_ARCHIVED`, `BUSINESS_DATE_IN_FUTURE`.

#### `PATCH /api/purchase-batches/:id`
- **Access:** `@RequirePermission('purchases.edit')`.
- **Body:** `PurchaseBatchUpdateBody = z.strictObject({ version: Version, date: BusinessDate.optional(), quantity: Quantity.optional(), unitCost: Money.optional(), note: optionalText(500) })` + at least one field besides `version`.
- **Steps:** read batch (not found or deleted → `BATCH_NOT_FOUND`); `lockItems([batch.itemId])`; `lockBatch(id)`; re-check not deleted; version check; date ≤ today; `delta = newQuantity − oldQuantity`; if `delta ≠ 0`: `quantity_on_hand + delta < 0` → `STOCK_INSUFFICIENT`, movement `BATCH_EDIT` (`+delta`), update item; recompute `total_cost`; `version += 1`. Editing is allowed when the item is archived. A body identical to the stored row changes nothing: no version bump, no movement, no audit row (Q37).
- **Writes:** audit `UPDATE` (entity `PURCHASE_BATCH`, before/after, params `{ itemName, quantity, fields }` — field names only, §11.3).
- **Response:** 200 `PurchaseBatchDto`.
- **Errors:** `BATCH_NOT_FOUND`, `VERSION_CONFLICT`, `STOCK_INSUFFICIENT`, `BUSINESS_DATE_IN_FUTURE`.

#### `DELETE /api/purchase-batches/:id?version=N`
- **Access:** `@RequirePermission('purchases.delete')`.
- **Steps:** read, lock item, lock batch, version check; `quantity_on_hand − quantity < 0` → `STOCK_INSUFFICIENT`; movement `BATCH_DELETE` (`−quantity`); set `deleted_at`, `deleted_by_user_id`, `version += 1`.
- **Writes:** audit `DELETE` (entity `PURCHASE_BATCH`, before includes cost, params `{ itemName, quantity }`).
- **Response:** 204.
- **Errors:** `BATCH_NOT_FOUND`, `VERSION_CONFLICT`, `STOCK_INSUFFICIENT`.

### 6.17 Customers (`apps/api/src/modules/customers/customers.controller.ts`)

The summary of every `CustomerDto` comes from `LEFT JOIN (SELECT customer_id, SUM(out_quantity_total)::int AS pallets_out, SUM(out_value)::bigint AS out_value, SUM(owed)::bigint AS owed, SUM(held)::bigint AS held, SUM(compensation)::bigint AS compensation, COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open_order_count FROM orders WHERE cancelled_at IS NULL GROUP BY customer_id)` (4.5: per-order `held` is summed, never recomputed). The route `GET /api/customers/phone-check` is declared before `GET /api/customers/:id`.

#### `GET /api/customers`
- **Access:** `@RequirePermission('customers.view')`.
- **Query:** `CustomerListQuery = z.strictObject({ ...PageQuery, q: SearchQuery /* name, phone, alt_phone */, includeArchived: BoolQuery.default(false), hasOpenOrders: BoolQuery.optional(), sort: sortParam(['name','palletsOut','outValue','owed','held','createdAt'], 'name') })`.
- **Response:** 200 `PageDto<CustomerDto>`.

#### `GET /api/customers/phone-check`
- **Access:** `@RequirePermission('customers.view')`.
- **Query:** `CustomerPhoneCheckQuery = z.strictObject({ phone: Phone, excludeId: IdParam.optional() })`.
- **Response:** 200 `{ normalizedPhone: string; matches: { customerId: number; name: string; archived: boolean; matchedField: 'phone' | 'altPhone' }[] }` — every customer (archived included) except `excludeId` whose `phone` or `alt_phone` equals `normalizedPhone`.

#### `GET /api/customers/:id`
- **Access:** `@RequirePermission('customers.view')`.
- **Response:** 200 `CustomerDetailDto`. **Errors:** `CUSTOMER_NOT_FOUND`.

#### `GET /api/customers/:id/history`
- **Access:** `@RequirePermission('customers.view', 'orders.view')`.
- **Query:** `CustomerHistoryQuery = z.strictObject({ ...PageQuery, kinds: z.string().optional() /* comma list of HANDOVER,RETURN,LEDGER; default all; unknown value → invalid_enum */, includeCancelled: BoolQuery.default(false), ...dateRange })`.
- **Strategy:** one `UNION ALL` of `(kind, id, date, created_at)` from orders (`date`), returns (`date`), ledger entries (`COALESCE(le.date, o.date)`), filtered by customer, `includeCancelled` (`o.cancelled_at IS NULL` when false) and date range; ordered by `date DESC, created_at DESC, kind ASC, id DESC`; paged; then the page's rows are hydrated in three batched queries. Reversed returns are included with `reversed: true`.
- **Response:** 200 `PageDto<CustomerHistoryItemDto>`. **Errors:** `CUSTOMER_NOT_FOUND`, `DATE_RANGE_INVALID`.

#### `POST /api/customers`
- **Access:** `@RequirePermission('customers.create')`.
- **Body:**
```ts
CustomerCreateBody = z.strictObject({
  name: Name200, phone: Phone, altPhone: Phone.nullable().default(null),
  address: z.string().trim().min(1).max(300),
  creditLimit: Money.nullable(),                   // null = no limit; 0 = may take nothing
  confirmDuplicatePhone: z.boolean().default(false),
})   // refine: altPhone !== phone → else field error { path: 'altPhone', code: 'duplicate' }
```
- **Steps:** duplicate search (phone and altPhone against every other customer's phone and alt_phone, archived included); matches and `confirmDuplicatePhone !== true` → `CUSTOMER_PHONE_DUPLICATE { matches }`; insert.
- **Writes:** audit `CREATE` (entity `CUSTOMER`, after, params `{ name }` as §11.3).
- **Response:** 201 `CustomerDto`.
- **Errors:** `CUSTOMER_PHONE_DUPLICATE`.

#### `PATCH /api/customers/:id`
- **Access:** `@RequirePermission('customers.edit')`.
- **Body:** `CustomerUpdateBody = z.strictObject({ version: Version, name: Name200.optional(), phone: Phone.optional(), altPhone: Phone.nullable().optional(), address: z.string().trim().min(1).max(300).optional(), creditLimit: Money.nullable().optional(), confirmDuplicatePhone: z.boolean().default(false) })` + at least one data field.
- **Steps:** `lockCustomer`; not found; archived → `CUSTOMER_ARCHIVED`; version check; the resulting phone ≠ resulting altPhone (field error `duplicate`); duplicate check only when `phone` or `altPhone` changes; update; `version += 1`. Lowering `creditLimit` below the current out value is allowed (it only blocks future increases). A body identical to the stored row changes nothing (Q37).
- **Writes:** audit `UPDATE` (entity `CUSTOMER`, before/after changed fields, params `{ name, fields }` as §11.3).
- **Response:** 200 `CustomerDto`.
- **Errors:** `CUSTOMER_NOT_FOUND`, `CUSTOMER_ARCHIVED`, `VERSION_CONFLICT`, `CUSTOMER_PHONE_DUPLICATE`.

#### `DELETE /api/customers/:id?version=N`
- **Access:** `@RequirePermission('customers.delete')`. Always an archive.
- **Steps:** `lockCustomer`; not found; already archived → `CUSTOMER_ALREADY_ARCHIVED`; version check; `COUNT(*) FROM orders WHERE customer_id = $1 AND status = 'OPEN'` > 0 → `CUSTOMER_HAS_OPEN_ORDERS { openOrderCount }`; set `archived_at`, `archived_by_user_id`, `version += 1`.
- **Writes:** audit `DELETE` (entity `CUSTOMER`, params `{ name }` as §11.3).
- **Response:** 200 `CustomerDto`.
- **Errors:** `CUSTOMER_NOT_FOUND`, `CUSTOMER_ALREADY_ARCHIVED`, `CUSTOMER_HAS_OPEN_ORDERS`, `VERSION_CONFLICT`.

### 6.18 Drivers (`apps/api/src/modules/drivers/drivers.controller.ts`)

#### `GET /api/drivers`
- **Access:** `@RequirePermission('drivers.view')`.
- **Query:** `DriverListQuery = z.strictObject({ ...PageQuery, q: SearchQuery /* name, phone, car_number */, includeArchived: BoolQuery.default(false), sort: sortParam(['name','createdAt'], 'name') })`.
- **Response:** 200 `PageDto<DriverDto>`.

#### `GET /api/drivers/:id`
- **Access:** `@RequirePermission('drivers.view')`. **Response:** 200 `DriverDto`. **Errors:** `DRIVER_NOT_FOUND`.

#### `POST /api/drivers`
- **Access:** `@RequirePermission('drivers.create')`.
- **Body:** `DriverCreateBody = z.strictObject({ name: Name200, phone: Phone, carNumber: z.string().trim().min(1).max(50) })`. No duplicate check.
- **Writes:** audit `CREATE` (entity `DRIVER`, after, params `{ name }` as §11.3).
- **Response:** 201 `DriverDto`.

#### `PATCH /api/drivers/:id`
- **Access:** `@RequirePermission('drivers.edit')`.
- **Body:** `DriverUpdateBody = z.strictObject({ version: Version, name: Name200.optional(), phone: Phone.optional(), carNumber: z.string().trim().min(1).max(50).optional() })` + at least one data field.
- **Steps:** `lockDriver`; not found; archived → `DRIVER_ARCHIVED`; version check; update; `version += 1`. Existing orders show the driver's current data (drivers are references, not snapshots). A body identical to the stored row changes nothing (Q37).
- **Writes:** audit `UPDATE` (entity `DRIVER`, before/after changed fields, params `{ name, fields }` as §11.3).
- **Response:** 200 `DriverDto`. **Errors:** `DRIVER_NOT_FOUND`, `DRIVER_ARCHIVED`, `VERSION_CONFLICT`.

#### `DELETE /api/drivers/:id?version=N`
- **Access:** `@RequirePermission('drivers.delete')`. Always an archive; allowed at any time.
- **Writes:** audit `DELETE` (entity `DRIVER`, params `{ name }` as §11.3).
- **Response:** 200 `DriverDto`. **Errors:** `DRIVER_NOT_FOUND`, `DRIVER_ALREADY_ARCHIVED`, `VERSION_CONFLICT`.

### 6.19 Orders (`apps/api/src/modules/orders/orders.controller.ts`)

Shared line schema:

```ts
OrderLineInput = z.strictObject({ itemId: Id, quantity: Quantity, unitDeposit: Money.optional() })
```

#### `GET /api/orders`
- **Access:** `@RequirePermission('orders.view')`.
- **Query:**
```ts
OrderListQuery = z.strictObject({
  ...PageQuery,
  status: z.enum(['OPEN','SETTLED','CANCELLED','ALL']).default('OPEN'),
  customerId: IdParam.optional(), driverId: IdParam.optional(),
  itemId: IdParam.optional(),                      // orders having a line for this item
  paymentType: z.enum(PAYMENT_TYPES).optional(),
  ...dateRange,                                    // on orders.date
  q: SearchQuery,                                  // all digits → order_number = q OR customer name ILIKE; otherwise customer name ILIKE
  sort: sortParam(['orderNumber','date','owed','outValue'], '-orderNumber'),
})
```
- **Response:** 200 `PageDto<OrderListItemDto>`. **Errors:** `DATE_RANGE_INVALID`.

#### `GET /api/orders/:id`
- **Access:** `@RequirePermission('orders.view')`.
- **Response:** 200 `OrderDetailDto`. **Errors:** `ORDER_NOT_FOUND`.

#### `POST /api/orders`
- **Access:** `@RequirePermission('orders.create')`; idempotent (scope `ORDER_CREATE`); `unitDeposit` on any line requires `orders.editUnitDeposit`; `confirmCreditOverride: true` requires role ADMIN.
- **Body:**
```ts
OrderCreateBody = z.strictObject({
  customerId: Id, driverId: Id, date: BusinessDate,
  paymentType: z.enum(PAYMENT_TYPES),
  notes: optionalText(1000),
  lines: z.array(OrderLineInput).min(1).max(50),
  confirmCreditOverride: z.boolean().default(false),
})
```
- **Steps:**
  1. Idempotency (6.7) — replay returns here.
  2. Duplicate `itemId` in `lines` → `VALIDATION_FAILED` with `duplicate` on the repeated line's `itemId` (the schema's refine, Q38).
  3. Any line has `unitDeposit` and the user lacks `orders.editUnitDeposit` → `UNIT_DEPOSIT_NOT_PERMITTED { lineIndexes }` (never silently overridden).
  4. `confirmCreditOverride = true` and the user is not ADMIN → `ADMIN_ONLY`.
  5. `date` ≤ today → else `BUSINESS_DATE_IN_FUTURE`.
  6. Transaction: `lockCustomer(customerId)`; missing → `CUSTOMER_NOT_FOUND`; archived → `CUSTOMER_ARCHIVED`.
  7. Load driver; missing → `DRIVER_NOT_FOUND`; archived → `DRIVER_ARCHIVED`.
  8. `lockItems(line itemIds)`; each missing → `ITEM_NOT_FOUND`; archived → `ITEM_ARCHIVED`; collect every line with `quantity > quantity_on_hand` → `STOCK_INSUFFICIENT { items }`.
  9. `unitDeposit = line.unitDeposit ?? item.depositPrice`; `lineTotal = quantity × unitDeposit` (safe-integer check); `depositTotal = Σ lineTotal`.
  10. Credit rule (4.4): `customerOutValue = SELECT COALESCE(SUM(out_value), 0)::bigint FROM orders WHERE customer_id = ${customerId} AND cancelled_at IS NULL`; `checkCreditLimit({ creditLimit, customerOutValue, depositDelta: depositTotal })`. Not allowed: ADMIN with `confirmCreditOverride` → proceed and set `credit_override_by_user_id`, `credit_override_at`; otherwise → `CREDIT_LIMIT_EXCEEDED { creditLimit, customerOutValue, depositDelta, excess, canOverride: isAdmin }`.
  11. `lockOrderCounter`; `orderNumber = last_number + 1`; `UPDATE order_counter SET last_number = ${orderNumber} WHERE id = 1`.
  12. Insert order and lines (`out_quantity = quantity`).
  13. One `ORDER_CREATE` movement per line (`−quantity`, `order_id`); update each item's `quantity_on_hand`.
  14. `paymentType = 'CASH'` and `depositTotal > 0` → ledger `PAYMENT`, source `ORDER_CREATE`, `is_automatic = true`, `date = NULL`, `amount = depositTotal`.
  15. `recomputeOrder`.
  16. Audit rows; idempotency row (last statement).
- **Writes:** movements `ORDER_CREATE`; ledger `PAYMENT` (automatic, CASH only); audit `CREATE` (entity `ORDER`, after = header + lines, params `{ orderNumber, customerName, paymentType, depositTotal }` as §11.3), `PAYMENT_CREATE` (entity `LEDGER_ENTRY`, params `{ orderNumber, amount, automatic }` as §11.3) when a payment was written, `CREDIT_OVERRIDE` (entity `ORDER`, after `{ creditLimit, customerOutValue, depositDelta, excess }`, params `{ orderNumber, customerName, excess }`) when overridden.
- **Response:** 201 `OrderDetailDto`.
- **Errors:** `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID`, `IDEMPOTENCY_KEY_REUSED`, `UNIT_DEPOSIT_NOT_PERMITTED`, `ADMIN_ONLY`, `BUSINESS_DATE_IN_FUTURE`, `CUSTOMER_NOT_FOUND`, `CUSTOMER_ARCHIVED`, `DRIVER_NOT_FOUND`, `DRIVER_ARCHIVED`, `ITEM_NOT_FOUND`, `ITEM_ARCHIVED`, `STOCK_INSUFFICIENT`, `CREDIT_LIMIT_EXCEEDED`.

#### `PATCH /api/orders/:id`
- **Access:** `@RequirePermission('orders.edit')`; `unitDeposit` on any line requires `orders.editUnitDeposit`; `confirmCreditOverride: true` requires ADMIN. `customerId` and `paymentType` are not in the schema (unknown keys → `VALIDATION_FAILED`): they are immutable.
- **Body:**
```ts
OrderUpdateBody = z.strictObject({
  version: Version,
  driverId: Id.optional(), date: BusinessDate.optional(), notes: optionalText(1000),
  lines: z.array(OrderLineInput).min(1).max(50).optional(),   // the complete desired line set
  confirmCreditOverride: z.boolean().default(false),
})   // refine: at least one of driverId, date, notes, lines
```
- **Steps:**
  1. Pre-lock checks: duplicate `itemId` → `VALIDATION_FAILED` `duplicate` (schema, Q38); `unitDeposit` without permission → `UNIT_DEPOSIT_NOT_PERMITTED`; override by non-admin → `ADMIN_ONLY`; `date` ≤ today.
  2. Read order (missing → `ORDER_NOT_FOUND`); `lockCustomer(order.customerId)`; `lockOrder`; if `lines` present `lockItems(old ∪ new item ids)`.
  3. Version check; cancelled → `ORDER_CANCELLED`.
  4. `driverId` changed → driver exists (`DRIVER_NOT_FOUND`) and is not archived (`DRIVER_ARCHIVED`).
  5. `date` present → must be ≤ the earliest `date` among non-reversed returns and non-reversed MANUAL payments of the order → else `ORDER_DATE_AFTER_ACTIVITY { earliestActivityDate }`. The automatic payment's date follows automatically (derived at read time).
  6. `lines` present:
     - Activity gate: any non-reversed return or non-reversed MANUAL payment → `ORDER_HAS_ACTIVITY`.
     - Diff by `itemId`. Kept item: new `quantity`; `unitDeposit` = supplied value or the stored one. Added item: must exist (`ITEM_NOT_FOUND`) and be active (`ITEM_ARCHIVED`); `unitDeposit` = supplied value or the item's current `depositPrice`. Removed item: its line row is deleted — unless a return, even a reversed one, has lines on it, which → `ORDER_LINE_HAS_RETURNS { itemId }` (Q40). A kept line whose item is archived may keep or lower its quantity; raising it → `ITEM_ARCHIVED`.
     - Stock: per item `movement = oldQuantity − newQuantity` (removed: `+old`; added: `−new`); an item whose resulting `quantity_on_hand` < 0 → `STOCK_INSUFFICIENT`. One `ORDER_LINE_EDIT` movement per item with a non-zero movement.
     - `depositDelta = newDepositTotal − oldDepositTotal`; if `> 0`, run the credit rule with the current `customerOutValue` (which already contains this order's current `out_value`) and `depositDelta`; override handling as in create.
     - CASH order and the line set changed (any added, removed or changed line — §4.8): if a non-reversed automatic PAYMENT exists → `PAYMENT_REVERSAL` of its full amount (source `ORDER_LINE_EDIT`, `date` = today, `reverses_entry_id`); if `newDepositTotal > 0` → new automatic `PAYMENT` (source `ORDER_LINE_EDIT`, `is_automatic = true`, `date = NULL`, `amount = newDepositTotal`). Each step is skipped only when its amount would be 0. This applies even when `newDepositTotal = oldDepositTotal` (the pair nets to zero; owed stays 0). A request whose `lines` equal the stored lines exactly is not a line change and writes no ledger rows or movements.
  7. Apply header fields; `recomputeOrder` (`version += 1`). A request whose header fields and lines all equal the stored ones changes nothing: no version bump, no audit row (Q37).
- **Writes:** movements `ORDER_LINE_EDIT`; ledger `PAYMENT_REVERSAL` / `PAYMENT` (CASH only); audit `UPDATE` (entity `ORDER`, before/after of header fields and lines, params `{ orderNumber }`), `PAYMENT_REVERSE` and `PAYMENT_CREATE` per ledger row, `CREDIT_OVERRIDE` when overridden.
- **Response:** 200 `OrderDetailDto`.
- **Errors:** `ORDER_NOT_FOUND`, `ORDER_CANCELLED`, `VERSION_CONFLICT`, `UNIT_DEPOSIT_NOT_PERMITTED`, `ADMIN_ONLY`, `BUSINESS_DATE_IN_FUTURE`, `DRIVER_NOT_FOUND`, `DRIVER_ARCHIVED`, `ORDER_DATE_AFTER_ACTIVITY`, `ORDER_HAS_ACTIVITY`, `ORDER_LINE_HAS_RETURNS`, `ITEM_NOT_FOUND`, `ITEM_ARCHIVED`, `STOCK_INSUFFICIENT`, `CREDIT_LIMIT_EXCEEDED`.

#### `POST /api/orders/:id/cancel`
- **Access:** `@RequirePermission('orders.cancel')`.
- **Body:** `OrderCancelBody = z.strictObject({ version: Version })`.
- **Steps:** read order; `lockCustomer`; `lockOrder`; `lockItems(line item ids)`; version check; cancelled → `ORDER_CANCELLED`; activity gate → `ORDER_HAS_ACTIVITY`; one `ORDER_CANCEL` movement per line (`+quantity`); non-reversed automatic PAYMENT exists → `PAYMENT_REVERSAL` (source `ORDER_CANCEL`, date today); set `cancelled_at = now()`, `cancelled_by_user_id`, `version += 1`; `recomputeOrder` (status `CANCELLED`, all derived values 0). The order number stays allocated.
- **Writes:** movements `ORDER_CANCEL`; ledger `PAYMENT_REVERSAL` (CASH with payment); audit `CANCEL` (entity `ORDER`, params `{ orderNumber, customerName }`), `PAYMENT_REVERSE`.
- **Response:** 200 `OrderDetailDto`.
- **Errors:** `ORDER_NOT_FOUND`, `VERSION_CONFLICT`, `ORDER_CANCELLED`, `ORDER_HAS_ACTIVITY`.

#### `GET /api/orders/:id/receipt`
- **Access:** `@RequirePermission('orders.view')`.
- **Steps:** load order, customer, driver, lines (by `order_lines.id` asc, item name), settings with logo; cancelled → `ORDER_CANCELLED`; `sheets = chunkReceiptLines(lines, RECEIPT_LINES_PER_HALF).map((chunk, i, all) => ({ sheetNumber: i + 1, sheetCount: all.length, lines: chunk, showTotal: i === all.length − 1 }))`; `orderNumberDisplay = String(orderNumber).padStart(6, '0')`.
- **Response:** 200 `ReceiptDto`. Worked example: 14 lines → 3 sheets with 6, 6, 2 lines; `depositTotal` printed only on sheet 3; each sheet shows "sheet X of 3".
- **Errors:** `ORDER_NOT_FOUND`, `ORDER_CANCELLED`.

### 6.20 Returns (`apps/api/src/modules/returns/returns.controller.ts`)

Shared schemas:

```ts
ReturnLineInput = z.strictObject({
  orderLineId: Id,
  acceptedQuantity: NonNegQuantity,
  damagedQuantity: NonNegQuantity,
  damagedRefund: Money.default(0),
})
ReturnCreateBody = z.strictObject({
  date: BusinessDate,
  notes: optionalText(1000),
  lines: z.array(ReturnLineInput).max(50)          // entries returning nothing are dropped (Q41); [] → RETURN_EMPTY (service)
    .transform((lines) => lines.filter((l) => l.acceptedQuantity + l.damagedQuantity > 0 || l.damagedRefund > 0)),
})
ReturnReplaceBody = ReturnCreateBody
```

The web app sends only order lines where the user entered a non-zero accepted or damaged quantity.

**Validation routine `validateReturnAgainstOrder(order, body)`** (shared by create and replace, run under the order lock against the given order state):
1. `lines.length = 0` → `RETURN_EMPTY`.
2. Duplicate `orderLineId` → `RETURN_DUPLICATE_LINE`.
3. `orderLineId` not a line of the order → `RETURN_LINE_NOT_IN_ORDER`.
4. `date` ≤ today → else `BUSINESS_DATE_IN_FUTURE`; `date` ≥ order `date` → else `RETURN_DATE_BEFORE_ORDER_DATE { orderDate }`.
5. `damagedRefund > damagedQuantity × unitDeposit` (the line's stored `unit_deposit`) → `DAMAGED_REFUND_TOO_HIGH { orderLineId, maximum }`.
6. `acceptedQuantity + damagedQuantity > outQuantity` for any line → `RETURN_EXCEEDS_OUT { lines: [every offending line] }`.

**Money** (4.3): `refundDue = returnRefundDue(lines with the stored unitDeposit)`; `owedBefore` = `computeOrderTotals` of the order's current state (loaded under the lock, in ledger insertion order); `{ cashRefund } = returnMoney(owedBefore, refundDue)`.

#### `POST /api/orders/:orderId/returns`
- **Access:** `@RequirePermission('returns.create')`; idempotent (scope `RETURN_CREATE`).
- **Body:** `ReturnCreateBody`.
- **Steps:** idempotency; `lockOrder(orderId)` (missing → `ORDER_NOT_FOUND`); cancelled → `ORDER_CANCELLED`; `lockItems(item ids of lines with acceptedQuantity > 0)`; `validateReturnAgainstOrder`; compute money; insert `returns` (`refund_due`, `owed_before`, `cash_refund`) and `return_lines` (copy `unit_deposit`); `RETURN_ACCEPTED` movement per line with `acceptedQuantity > 0` (`+accepted`, `order_id`, `return_id`), update items; `cashRefund > 0` → ledger `REFUND` (source `RETURN_CREATE`, `date` = return date, `return_id`, `amount = cashRefund`); `recomputeOrder`; audit; idempotency row.
- **Writes:** movements `RETURN_ACCEPTED`; ledger `REFUND`; audit `RETURN_CREATE` (entity `RETURN`, after = the return snapshot with `lines[]`, params `{ orderNumber, accepted, damaged, refundDue, cashRefund }` as §11.3), `REFUND_CREATE` (entity `LEDGER_ENTRY`, params `{ orderNumber, amount }`).
- **Response:** 201 `ReturnResultDto`.
- **Errors:** idempotency codes, `ORDER_NOT_FOUND`, `ORDER_CANCELLED`, `RETURN_EMPTY`, `RETURN_DUPLICATE_LINE`, `RETURN_LINE_NOT_IN_ORDER`, `BUSINESS_DATE_IN_FUTURE`, `RETURN_DATE_BEFORE_ORDER_DATE`, `DAMAGED_REFUND_TOO_HIGH`, `RETURN_EXCEEDS_OUT`.

#### `POST /api/returns/:id/replace` (edit)
- **Access:** `@RequirePermission('returns.edit')`. Not idempotent (a replay after success fails with `RETURN_ALREADY_REVERSED`, which the web app treats as "already applied" and reloads the order).
- **Body:** `ReturnReplaceBody`.
- **Steps:**
  1. Read return R (missing → `RETURN_NOT_FOUND`); `lockOrder(R.orderId)`; re-read R; `R.reversedAt` set → `RETURN_ALREADY_REVERSED`; `lockItems(item ids with accepted > 0 in R ∪ body)`.
  2. Reverse R: one `RETURN_EDIT` movement per R line with `acceptedQuantity > 0` (`−accepted`, `return_id = R.id`); if R has a `REFUND` row → `REFUND_REVERSAL` (source `RETURN_EDIT`, `date` = today, `reverses_entry_id`, `return_id = R.id`, same amount).
  3. Build the order state with R treated as reversed and the reversal rows included; run `validateReturnAgainstOrder` on it; compute `owedBefore`, `refundDue`, `cashRefund` from that state.
  4. Insert the new return N with its lines; `RETURN_ACCEPTED` movements for N; `REFUND` (source `RETURN_EDIT`, `date` = N's date, `return_id = N.id`) if `cashRefund > 0`.
  5. Stock: per item net of steps 2 and 4 must keep `quantity_on_hand ≥ 0` → else `STOCK_INSUFFICIENT`; one `UPDATE` per item with the net.
  6. One `UPDATE returns SET reversed_at = now(), reversed_by_user_id = ${userId}, reversal_kind = 'EDIT', replaced_by_return_id = ${N.id} WHERE id = ${R.id}` (the only permitted update of a return row).
  7. `recomputeOrder`.
- **Writes:** movements `RETURN_EDIT`, `RETURN_ACCEPTED`; ledger `REFUND_REVERSAL`, `REFUND`; audit `RETURN_EDIT` (entity `RETURN`, entityId R.id, before = R, after = N, params `{ orderNumber, newReturnId }`), `REFUND_REVERSE`, `REFUND_CREATE` per ledger row. Cash refunds of other returns are never recomputed.
- **Response:** 201 `ReturnResultDto` (`returnId` = N.id).
- **Errors:** `RETURN_NOT_FOUND`, `RETURN_ALREADY_REVERSED`, `ORDER_CANCELLED`, the validation-routine codes, `STOCK_INSUFFICIENT`.

#### `DELETE /api/returns/:id`
- **Access:** `@RequirePermission('returns.delete')`. Meaning: this return never happened.
- **Steps:** read R; `lockOrder`; re-read; reversed → `RETURN_ALREADY_REVERSED`; `lockItems(item ids with accepted > 0 in R)`; stock check (`quantity_on_hand − accepted ≥ 0`, else `STOCK_INSUFFICIENT`); `RETURN_DELETE` movements (`−accepted`); `REFUND_REVERSAL` (source `RETURN_DELETE`, date today) if R has a refund; `UPDATE returns SET reversed_at, reversed_by_user_id, reversal_kind = 'DELETE'`; `recomputeOrder`.
- **Writes:** movements `RETURN_DELETE`; ledger `REFUND_REVERSAL`; audit `RETURN_DELETE` (entity `RETURN`, before = R, after = `{ reversedAt, reversalKind: 'DELETE' }` as §11.2, params `{ orderNumber }`), `REFUND_REVERSE`.
- **Response:** 200 `ReturnResultDto` (`returnId` = R.id).
- **Errors:** `RETURN_NOT_FOUND`, `RETURN_ALREADY_REVERSED`, `STOCK_INSUFFICIENT`.

Worked example (4.3 example 8): CASH order 100 × 1,000; return of 50 accepted recorded (REFUND 50,000, stock +50); `DELETE /api/returns/:id` → `RETURN_DELETE −50`, `REFUND_REVERSAL 50,000`; after recompute `owed = 100,000 − 100,000 − 0 + (50,000 − 50,000) = 0`, `outValue = 100,000`, `held = 100,000`, status `OPEN`.

### 6.21 Payments and ledger (`apps/api/src/modules/ledger/ledger.controller.ts`)

#### `POST /api/orders/:orderId/payments`
- **Access:** `@RequirePermission('payments.create')`; idempotent (scope `PAYMENT_CREATE`).
- **Body:** `PaymentCreateBody = z.strictObject({ date: BusinessDate, amount: PositiveMoney, note: optionalText(500) })`.
- **Steps:** idempotency; `date` ≤ today; `lockOrder`; missing → `ORDER_NOT_FOUND`; cancelled → `ORDER_CANCELLED`; `paymentType ≠ 'LENT'` → `PAYMENT_ORDER_NOT_LENT`; `date < order.date` → `PAYMENT_DATE_BEFORE_ORDER_DATE`; current `owed` (from `computeOrderTotals` under the lock) `< amount` → `PAYMENT_EXCEEDS_OWED { owed, amount }`; insert ledger `PAYMENT` (source `MANUAL`, `is_automatic = false`, `date`, `note`); `recomputeOrder`.
- **Writes:** ledger `PAYMENT`; audit `PAYMENT_CREATE` (entity `LEDGER_ENTRY`, params `{ orderNumber, amount, automatic: false }` as §11.3).
- **Response:** 201 `PaymentResultDto`.
- **Errors:** idempotency codes, `BUSINESS_DATE_IN_FUTURE`, `ORDER_NOT_FOUND`, `ORDER_CANCELLED`, `PAYMENT_ORDER_NOT_LENT`, `PAYMENT_DATE_BEFORE_ORDER_DATE`, `PAYMENT_EXCEEDS_OWED`.

#### `POST /api/ledger-entries/:id/reverse` (delete a manual payment)
- **Access:** `@RequirePermission('payments.delete')`.
- **Body:** `LedgerEntryReverseBody = z.strictObject({ note: optionalText(500) })`.
- **Steps:** read entry E (missing → `LEDGER_ENTRY_NOT_FOUND`); `lockOrder(E.orderId)`; `E.type ≠ 'PAYMENT'` or `E.source ≠ 'MANUAL'` → `LEDGER_ENTRY_NOT_REVERSIBLE { type, source }`; a row with `reverses_entry_id = E.id` exists → `LEDGER_ENTRY_ALREADY_REVERSED`; insert `PAYMENT_REVERSAL` (source `PAYMENT_DELETE`, `date` = today, `amount = E.amount`, `reverses_entry_id = E.id`, `note`); `recomputeOrder` (owed increases by `E.amount`).
- **Writes:** ledger `PAYMENT_REVERSAL`; audit `PAYMENT_REVERSE` (entity `LEDGER_ENTRY`, entityId = the reversal row's id as §11.3, params `{ orderNumber, amount }`).
- **Response:** 200 `PaymentResultDto` (`ledgerEntryId` = the reversal row id).
- **Errors:** `LEDGER_ENTRY_NOT_FOUND`, `LEDGER_ENTRY_NOT_REVERSIBLE`, `LEDGER_ENTRY_ALREADY_REVERSED`.

#### `GET /api/ledger-entries`
- **Access:** `@RequirePermission('orders.view')`.
- **Query:**
```ts
LedgerEntryListQuery = z.strictObject({
  ...PageQuery,
  customerId: IdParam.optional(), orderId: IdParam.optional(),
  type: z.string().optional(),                     // comma list of LedgerEntryType; default all
  ...dateRange,                                    // on COALESCE(le.date, o.date)
  includeCancelledOrders: BoolQuery.default(false),
  sort: sortParam(['effectiveDate','createdAt','amount'], '-effectiveDate'),
})
```
- **Response:** 200 `PageDto<LedgerEntryDto>`. The customer profile uses `type=PAYMENT,PAYMENT_REVERSAL` (payments list) and `type=REFUND,REFUND_REVERSAL` (refunds list).
- **Errors:** `DATE_RANGE_INVALID`.

### 6.22 Dashboard (`apps/api/src/modules/dashboard/dashboard.controller.ts`)

#### `GET /api/dashboard`
- **Access:** `@Authenticated()`; sections gated in the service.
- **Response:** 200 `DashboardDto`:
  - `positions` (only with `reports.viewPositions`): `SELECT SUM(out_quantity_total), SUM(out_value), SUM(owed), SUM(held), COUNT(*) FILTER (WHERE status='OPEN'), COUNT(DISTINCT customer_id) FILTER (WHERE status='OPEN') FROM orders WHERE cancelled_at IS NULL` (money sums cast `::bigint`).
  - `lowStock` (only with `items.view`): non-archived items with `min_stock IS NOT NULL AND quantity_on_hand <= min_stock`; `count` = all such items; `items` = first 10 ordered by `(quantity_on_hand − min_stock) ASC, name ASC`.
  - `recentActivity` (only with `orders.view`): the latest 10 events by `at DESC` from the union of orders created (`HANDOVER`, `at = created_at`), orders cancelled (`CANCELLATION`, `at = cancelled_at`), returns (`RETURN`, `at = created_at`, `reversed = reversed_at IS NOT NULL`), manual payments (`PAYMENT`, `source = 'MANUAL'`) and refunds (`REFUND`), each ledger event with `reversed` = a reversal row exists.
  - A section the user may not see is absent from the JSON.

### 6.23 Reports (`apps/api/src/modules/reports/reports.controller.ts`)

All report queries are single SQL aggregates (`$queryRaw` tagged templates, money sums cast `::bigint`) that exclude cancelled orders (`o.cancelled_at IS NULL`) and reversed returns (`r.reversed_at IS NULL`). Section 12 gives the SQL strategy per report.

#### `GET /api/reports/positions`
- **Access:** `@RequirePermission('reports.viewPositions')`.
- **Query:** `PositionsReportQuery = z.strictObject({ customerId: IdParam.optional(), includeZero: BoolQuery.default(false), sort: sortParam(['customerName','palletsOut','outValue','owed','held'], '-owed') })`. `includeZero=false` keeps customers with `palletsOut > 0 OR owed > 0 OR held > 0`.
- **Response:** 200 `PositionsReportDto` (snapshot; no date range). `totals` = column sums of the returned rows.

#### `GET /api/reports/purchases`
- **Access:** `@RequirePermission('reports.viewPurchases')`; the service also asserts `canViewCost` (→ `PERMISSION_DENIED { required: ['items.viewCost'] }`) so the refusal holds even if the dependency table changes.
- **Query:** `PurchasesReportQuery = z.strictObject({ dateFrom: BusinessDate, dateTo: BusinessDate, itemId: IdParam.optional() })` (both dates required).
- **Response:** 200 `PurchasesReportDto` — non-deleted batches with `date` in range; no averaging anywhere.
- **Errors:** `DATE_RANGE_INVALID`, `PERMISSION_DENIED`.

#### `GET /api/reports/activity`
- **Access:** `@RequirePermission('reports.viewActivity')`.
- **Query:** `ActivityReportQuery = z.strictObject({ dateFrom: BusinessDate, dateTo: BusinessDate, customerId: IdParam.optional(), itemId: IdParam.optional(), driverId: IdParam.optional() })`.
- **Rules:** hand-overs by `orders.date`; returns by `returns.date`; ledger rows by effective date `COALESCE(le.date, o.date)`, reversal rows listed as their own rows (never netted against the original); compensation per non-reversed return line = `damaged_quantity × unit_deposit − damaged_refund`, labelled "assessed". `customerId` and `driverId` filter through the order. `itemId` filters hand-over lines, return lines and compensation lines to that item; `payments` and `refunds` are `[]`, their totals 0, and `moneyOmitted = true`.
- **Response:** 200 `ActivityReportDto`. `totals.paymentsNet = paymentsGross − paymentReversals`; `totals.refundsNet = refundsGross − refundReversals`.
- **Errors:** `DATE_RANGE_INVALID`.

#### `GET /api/reports/stock`
- **Access:** `@RequirePermission('reports.viewStock')`.
- **Query:** `StockReportQuery = z.strictObject({ includeArchived: BoolQuery.default(false), lowStockOnly: BoolQuery.default(false), sort: sortParam(['name','quantityOnHand','quantityOut','damagedTotal'], 'name') })`.
- **Response:** 200 `StockReportDto` (snapshot).

### 6.24 Audit log (`apps/api/src/modules/audit/audit.controller.ts`)

#### `GET /api/audit-logs`
- **Access:** `@RequirePermission('audit.view')`. Read-only: no endpoint updates or deletes audit rows.
- **Query:**
```ts
AuditLogListQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  userId: IdParam.optional(), entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entityId: z.string().max(64).optional(), action: z.enum(AUDIT_ACTIONS).optional(),
  ...dateRange,                                    // on created_at, Asia/Baghdad day boundaries
})   // fixed order: id DESC
```
- **Response:** 200 `PageDto<AuditLogDto>`, `before`/`after` passed through `redactAuditPayload(entityType, payload, ctx)` (section 11) — for a viewer without `items.viewCost` every `unitCost` and `totalCost` key is removed at any depth of `PURCHASE_BATCH` and `ITEM` payloads.
- **Errors:** `DATE_RANGE_INVALID`.

### 6.25 Health

#### `GET /api/health`
- **Access:** `@Public()`; `@SkipThrottle({ global: true })`.
- **Steps:** `SELECT 1` with a 2-second statement timeout.
- **Response:** 200 `HealthDto` (`version` = `APP_VERSION`); database failure → 503 `SERVICE_UNAVAILABLE`.

### 6.26 Route → access table

| Method | Path | Access |
|---|---|---|
| POST | /api/auth/login | Public |
| POST | /api/auth/refresh | Public (cookie) |
| POST | /api/auth/logout | Public (cookie) |
| POST | /api/auth/logout-all | Authenticated |
| GET | /api/auth/me | Authenticated |
| POST | /api/auth/change-password | Authenticated |
| GET | /api/users | AdminOnly |
| POST | /api/users | AdminOnly |
| GET | /api/users/:id | AdminOnly |
| PATCH | /api/users/:id | AdminOnly |
| PUT | /api/users/:id/permissions | AdminOnly |
| POST | /api/users/:id/reset-password | AdminOnly |
| POST | /api/users/:id/logout-all | AdminOnly |
| GET | /api/settings | Authenticated |
| PUT | /api/settings | AdminOnly |
| POST | /api/uploads | Any of items.create, items.edit (+ ADMIN for FACTORY_LOGO) |
| GET | /api/uploads/:fileName | Public |
| GET | /api/items | items.view |
| GET | /api/items/:id | items.view |
| POST | /api/items | items.create (+ purchases.create with initialBatch) |
| PATCH | /api/items/:id | items.edit |
| DELETE | /api/items/:id | items.delete |
| POST | /api/items/:id/stock-adjustments | items.adjustStock |
| GET | /api/items/:id/stock-movements | items.view |
| GET | /api/purchase-batches | purchases.view (cost fields need items.viewCost) |
| POST | /api/purchase-batches | purchases.create |
| PATCH | /api/purchase-batches/:id | purchases.edit |
| DELETE | /api/purchase-batches/:id | purchases.delete |
| GET | /api/customers | customers.view |
| GET | /api/customers/phone-check | customers.view |
| GET | /api/customers/:id | customers.view |
| GET | /api/customers/:id/history | customers.view + orders.view |
| POST | /api/customers | customers.create |
| PATCH | /api/customers/:id | customers.edit |
| DELETE | /api/customers/:id | customers.delete |
| GET | /api/drivers | drivers.view |
| GET | /api/drivers/:id | drivers.view |
| POST | /api/drivers | drivers.create |
| PATCH | /api/drivers/:id | drivers.edit |
| DELETE | /api/drivers/:id | drivers.delete |
| GET | /api/orders | orders.view |
| GET | /api/orders/:id | orders.view |
| POST | /api/orders | orders.create (+ orders.editUnitDeposit for unitDeposit; ADMIN for override) |
| PATCH | /api/orders/:id | orders.edit (+ orders.editUnitDeposit; ADMIN for override) |
| POST | /api/orders/:id/cancel | orders.cancel |
| GET | /api/orders/:id/receipt | orders.view |
| POST | /api/orders/:orderId/returns | returns.create |
| POST | /api/returns/:id/replace | returns.edit |
| DELETE | /api/returns/:id | returns.delete |
| POST | /api/orders/:orderId/payments | payments.create |
| POST | /api/ledger-entries/:id/reverse | payments.delete |
| GET | /api/ledger-entries | orders.view |
| GET | /api/dashboard | Authenticated (sections gated) |
| GET | /api/reports/positions | reports.viewPositions |
| GET | /api/reports/purchases | reports.viewPurchases (+ items.viewCost) |
| GET | /api/reports/activity | reports.viewActivity |
| GET | /api/reports/stock | reports.viewStock |
| GET | /api/audit-logs | audit.view |
| GET | /api/health | Public |

Every one of the 33 grantable keys appears in this table (the dependency-only use of `items.viewCost` is enforced as a field filter and by the purchases report), and the three admin-only keys map to `@AdminOnly()` routes (`users.manage`), `PUT /api/settings` and `FACTORY_LOGO` uploads (`settings.edit`), and `confirmCreditOverride` (`orders.overrideCreditLimit`).

### 6.27 Schema index (`packages/shared/src/schemas/`)

| File | Exports |
|---|---|
| `common.ts` | `IdParam`, `Id`, `Version`, `VersionQuery`, `Money`, `PositiveMoney`, `Quantity`, `NonNegQuantity`, `BusinessDate`, `Name200`, `optionalText`, `Phone`, `SearchQuery`, `BoolQuery`, `PageQuery`, `sortParam`, `dateRange` |
| `zod-issues.ts` | `mapZodIssue` |
| `auth.ts` | `LoginBody`, `RefreshBody`, `ChangePasswordBody` |
| `users.ts` | `UserListQuery`, `UserCreateBody`, `UserUpdateBody`, `UserPermissionsBody`, `UserResetPasswordBody` |
| `settings.ts` | `SettingsUpdateBody` |
| `uploads.ts` | `UploadCreateQuery` |
| `items.ts` | `ItemListQuery`, `ItemCreateBody`, `ItemUpdateBody`, `StockAdjustmentCreateBody`, `StockMovementListQuery` |
| `purchases.ts` | `PurchaseBatchListQuery`, `PurchaseBatchCreateBody`, `PurchaseBatchUpdateBody` |
| `customers.ts` | `CustomerListQuery`, `CustomerPhoneCheckQuery`, `CustomerHistoryQuery`, `CustomerCreateBody`, `CustomerUpdateBody` |
| `drivers.ts` | `DriverListQuery`, `DriverCreateBody`, `DriverUpdateBody` |
| `orders.ts` | `OrderLineInput`, `OrderListQuery`, `OrderCreateBody`, `OrderUpdateBody`, `OrderCancelBody` |
| `returns.ts` | `ReturnLineInput`, `ReturnCreateBody`, `ReturnReplaceBody` |
| `payments.ts` | `PaymentCreateBody`, `LedgerEntryReverseBody`, `LedgerEntryListQuery` |
| `reports.ts` | `PositionsReportQuery`, `PurchasesReportQuery`, `ActivityReportQuery`, `StockReportQuery` |
| `audit.ts` | `AuditLogListQuery` |
| `dto.ts` | every interface of 6.9 (types only) |

For each schema `X`, the inferred type is exported as `type X = z.infer<typeof X>` (input variant `XInput = z.input<typeof X>` for forms). The web app's react-hook-form resolvers use these schemas directly, so client and server validation are identical.


## 7. Frontend specification

The web app lives in `apps/web`. It is a Vite 8 + React 19 single-page application written in strict TypeScript, using TanStack Router (file-based routes), TanStack Query, react-hook-form + zod (schemas from `@pallet/shared`), Tailwind CSS 4, shadcn/ui (Radix), lucide-react, i18next, and `motion`. The production build is static files served by Caddy at `/`. All API calls go to the same origin under `/api`.

### 7.1 Bootstrap order

The following steps happen in this exact order on every full page load.

1. **`index.html`** contains, in `<head>`, `<script src="/boot-prefs.js"></script>` (synchronous, no `defer`, no `type="module"`) **before** the Vite entry script. An inline script is forbidden by the CSP (`script-src 'self'`).
2. **`public/boot-prefs.js`** (plain ES2020, no imports, wrapped in `try { … } catch { }`):
   - reads `localStorage.getItem('pallet.prefs.v1')`, parses JSON, and validates each field against the allowed values (`language ∈ {ckb, ar, en}`, `theme ∈ {light, dark, system}`, `palette ∈ PALETTES`, `font ∈ FONT_FAMILIES`, `fontSize ∈ {sm, md, lg, xl}`); any invalid or missing field takes its default (`ckb`, `light`, `harbor`, `inter`, `md`) (Q50);
   - sets `document.documentElement.lang = language`, `dir = (language === 'en' ? 'ltr' : 'rtl')`;
   - toggles the class `dark` on `<html>` when `theme === 'dark'`, or when `theme === 'system'` and `matchMedia('(prefers-color-scheme: dark)')` matches; sets `data-palette` and `data-font` on `<html>`;
   - sets `document.documentElement.style.setProperty('--app-font-size', px + 'px')` with px from `{ sm: 14, md: 16, lg: 18, xl: 20 }` (same table as `FONT_SIZE_PX` in `@pallet/shared`).
   This prevents a flash of the wrong direction, theme or size before React mounts.
3. **`src/main.tsx`**:
   1. `import '@fontsource-variable/inter/wght.css'` and `import '@fontsource-variable/noto-sans-arabic/wght.css'` (Vite bundles the woff2 files; fonts are served from our origin, satisfying `font-src 'self'`).
   2. `import './styles/globals.css'`.
   3. `initI18n(readPreferences().language)` from `src/i18n/index.ts` (synchronous; resources are statically imported JSON).
   4. Create the `QueryClient` (`src/lib/query-client.ts`, section 7.8).
   5. Create the router (`src/router.tsx`): `createRouter({ routeTree, context: { queryClient, auth }, defaultPreload: 'intent', defaultPendingMs: 150, defaultPendingMinMs: 300, scrollRestoration: true })`.
   6. Render:
      ```tsx
      <StrictMode>
        <PreferencesProvider>          {/* language/theme/fontSize state + persistence */}
          <DirectionProvider>          {/* radix-ui Direction.Provider dir={ltr|rtl} */}
            <QueryClientProvider client={queryClient}>
              <AuthProvider>           {/* runs auth.bootstrap() once */}
                <MotionConfig reducedMotion="user">
                  <AppRouter />        {/* renders <BootScreen/> until bootstrap settles, then <RouterProvider/> */}
                  <Toaster />          {/* sonner, position="top-center", dir from preferences */}
                </MotionConfig>
              </AuthProvider>
            </QueryClientProvider>
          </DirectionProvider>
        </PreferencesProvider>
      </StrictMode>
      ```
4. **`auth.bootstrap()`** (`src/lib/auth.ts`) calls `refreshAccessToken()` (section 7.7). On 200 it stores the access token in memory and the `user` (MeDto) in the auth store. On 401 it marks the session anonymous. Until bootstrap settles, `<BootScreen/>` shows the app logo mark and a full-page `PageSkeleton` (no spinner).
5. **Route guards** (`beforeLoad`, section 7.2) redirect anonymous users to `/login?redirect=<current href>` and users with `mustChangePassword = true` to `/change-password`.

`src/routeTree.gen.ts` is generated by `@tanstack/router-plugin` (`tanstackRouter({ target: 'react', autoCodeSplitting: true })`, listed **before** `react()` in `vite.config.ts`). It is committed to git so `tsc --noEmit` works without a prior Vite run, and it is excluded from ESLint and Prettier.

### 7.2 Routing table

Conventions:
- Route files live under `apps/web/src/routes/`. `_app` is a pathless layout (authenticated shell). `_print` is a pathless layout (authenticated, no chrome, always light).
- **Permission gate:** every route file under `_app` and `_print` exports its route with `beforeLoad: requirePermission(<key>)`, `requireAdmin()` or `requireAuthenticated()` from `src/lib/route-guards.ts`. `requireAuthenticated()` throws `redirect({ to: '/login', search: { redirect: location.href } })` when anonymous, and `redirect({ to: '/change-password' })` when `mustChangePassword`. `requirePermission(key)` first applies `requireAuthenticated()`, then throws `new ForbiddenError()` when `!auth.can(key)`. `requireAnyPermission(...keys)` passes when at least one key is held. `requireAdmin()` throws `ForbiddenError` for non-admins. The root route's `errorComponent` renders `<ForbiddenPage/>` for `ForbiddenError` and `<ErrorPage/>` for anything else.
- `auth.can(key)` is true for every key when `user.role === 'ADMIN'`, otherwise `user.permissions.includes(key)`.
- The page title is `document.title = t(titleKey) + ' — ' + t('common.appName')`, set by the `usePageTitle(titleKey)` hook in each page component.
- Search params are validated with zod schemas through `validateSearch` (zod 4 implements Standard Schema, which TanStack Router accepts directly). List pages keep all filters, sort and page in the URL.

| Path | File (under `src/routes/`) | Layout | Gate | Title i18n key |
|---|---|---|---|---|
| (root) | `__root.tsx` | — | — | — |
| `/login` | `login.tsx` | none | anonymous only (authenticated users are redirected to `/`) | `auth.login.title` |
| `/change-password` | `change-password.tsx` | none | `requireAuthenticated()` without the must-change redirect | `auth.changePassword.title` |
| (layout) | `_app.tsx` | AppShell | `requireAuthenticated()` | — |
| `/` | `_app/index.tsx` | `_app` | `requireAuthenticated()` | `dashboard.title` |
| `/orders` | `_app/orders/index.tsx` | `_app` | `orders.view` | `orders.list.title` |
| `/orders/new` | `_app/orders/new.tsx` | `_app` | `orders.create` | `orders.new.title` |
| `/orders/$orderId` | `_app/orders/$orderId/index.tsx` | `_app` | `orders.view` | `orders.detail.title` |
| `/orders/$orderId/edit` | `_app/orders/$orderId/edit.tsx` | `_app` | `orders.edit` | `orders.edit.title` |
| `/returns/new` | `_app/returns/new.tsx` | `_app` | `returns.create` (plus `returns.edit` when `replaceReturnId` is present) | `returns.new.title` / `returns.replace.title` |
| `/payments/new` | `_app/payments/new.tsx` | `_app` | `payments.create` | `payments.new.title` |
| `/customers` | `_app/customers/index.tsx` | `_app` | `customers.view` | `customers.list.title` |
| `/customers/new` | `_app/customers/new.tsx` | `_app` | `customers.create` | `customers.new.title` |
| `/customers/$customerId` | `_app/customers/$customerId/index.tsx` | `_app` | `customers.view` | `customers.detail.title` |
| `/customers/$customerId/edit` | `_app/customers/$customerId/edit.tsx` | `_app` | `customers.edit` | `customers.edit.title` |
| `/drivers` | `_app/drivers/index.tsx` | `_app` | `drivers.view` | `drivers.list.title` |
| `/items` | `_app/items/index.tsx` | `_app` | `items.view` | `items.list.title` |
| `/items/new` | `_app/items/new.tsx` | `_app` | `items.create` | `items.new.title` |
| `/items/$itemId` | `_app/items/$itemId/index.tsx` | `_app` | `items.view` | `items.detail.title` |
| `/items/$itemId/edit` | `_app/items/$itemId/edit.tsx` | `_app` | `items.edit` | `items.edit.title` |
| `/reports` | `_app/reports/index.tsx` | `_app` | any of `reports.viewPositions`, `reports.viewPurchases`, `reports.viewActivity`, `reports.viewStock` | — (redirects) |
| `/reports/positions` | `_app/reports/positions.tsx` | `_app` | `reports.viewPositions` | `reports.positions.title` |
| `/reports/purchases` | `_app/reports/purchases.tsx` | `_app` | `reports.viewPurchases` | `reports.purchases.title` |
| `/reports/activity` | `_app/reports/activity.tsx` | `_app` | `reports.viewActivity` | `reports.activity.title` |
| `/reports/stock` | `_app/reports/stock.tsx` | `_app` | `reports.viewStock` | `reports.stock.title` |
| `/history` | `_app/history.tsx` | `_app` | `audit.view` | `history.title` |
| `/users` | `_app/users/index.tsx` | `_app` | `requireAdmin()` | `users.list.title` |
| `/users/new` | `_app/users/new.tsx` | `_app` | `requireAdmin()` | `users.new.title` |
| `/users/$userId` | `_app/users/$userId.tsx` | `_app` | `requireAdmin()` | `users.detail.title` |
| `/settings` | `_app/settings.tsx` | `_app` | — (any signed-in user; the factory section renders for admins only, Q50) | `settings.title` |
| `/account` | `_app/account.tsx` | `_app` | `requireAuthenticated()` | `account.title` |
| (layout) | `_print.tsx` | PrintLayout | `requireAuthenticated()` | — |
| `/print/orders/$orderId` | `_print/print/orders/$orderId.tsx` | `_print` | `orders.view` | `receipt.pageTitle` |
| any unknown path | `notFoundComponent` of `__root.tsx` | none | — | `common.notFound.title` |

`/reports` redirects (`beforeLoad` throws `redirect`) to the first report the user may view, in the order positions → purchases → activity → stock.

Navigation items (AppShell sidebar, in this order; an item is rendered only when its gate passes): Dashboard `/` (`LayoutDashboard`), Orders `/orders` (`ClipboardList`), Customers `/customers` (`Building2`), Items `/items` (`Package`), Drivers `/drivers` (`Truck`), Reports `/reports` (`BarChart3`), History `/history` (`History`), Users `/users` (`Users`), Settings `/settings` (`Settings`). Account and logout live in the user menu at the bottom of the sidebar (desktop) or in the top bar (mobile).

### 7.3 Page specifications

Common rules for every page:
- **Loading:** a `PageSkeleton` variant matching the page (`list`, `detail`, `form`, `report`, `dashboard`) is shown until the first successful response. Background refetches never replace content with skeletons.
- **Error:** a failed initial query renders `<QueryErrorState error onRetry/>`: the translated `errors.<code>` message, the `requestId` in small muted text, and a "Retry" button. `ORDER_NOT_FOUND`, `CUSTOMER_NOT_FOUND`, `ITEM_NOT_FOUND`, `DRIVER_NOT_FOUND`, `USER_NOT_FOUND` and `NOT_FOUND` render `<NotFoundState/>` with a link back to the list.
- **Empty:** lists with zero results render `<EmptyState icon title description action/>`. With active filters the text is `common.empty.filtered` and the action is "Clear filters". Without filters it names the next step: each list uses its own `<module>.list.empty` key plus its create action when the create permission is held (on `/orders`: `orders.list.empty` and "New order" with `orders.create`).
- **Actions:** a button is rendered only when its permission (or state condition) passes. Destructive actions (cancel order, delete return, delete payment, archive, deactivate user, reset password, logout everywhere) open a `ConfirmDialog`. Nothing else asks for confirmation except the duplicate-phone warning (A13), the admin credit-limit override, and the unsaved-changes guard.
- **Money** is shown with `MoneyText`, **quantities** with `QuantityText`, **dates** with `DateText` (section 7.5).
- Field constraints below reference the shared schemas (section 8). Numeric inputs use `MoneyInput` / `QuantityInput`; `<input type="number">` is never used.

#### 7.3.1 `/login`
- **Purpose:** sign in.
- **Data:** none.
- **Components:** centered `Card` with the factory name from the public build constant `common.appName`, a `LanguageSwitcher` (top inline-end corner), and a form.
- **Fields:** `username` (text, `autoComplete="username"`, autofocus, trimmed and lower-cased on submit, required, 3–32 chars), `password` (password input with show/hide toggle, `autoComplete="current-password"`, required, 1–128 chars).
- **Submit:** `POST /api/auth/login`. On 200: store the token and `user`; if `user.mustChangePassword`, navigate to `/change-password`; otherwise navigate to `search.redirect` when it is a relative path that starts with `/` and not with `//`, else to `/`.
- **Errors:** `AUTH_INVALID_CREDENTIALS` and `RATE_LIMITED` show a form-level destructive `Alert` with `errors.<code>` (never attached to a single field, so no hint about which field was wrong). `VALIDATION_FAILED` maps onto fields.
- **Static text:** `auth.login.forgotHint` ("Forgot your password? Ask an administrator to reset it.").

#### 7.3.2 `/change-password`
- **Purpose:** forced first-login password change, also reachable voluntarily.
- **Fields:** `currentPassword` (required), `newPassword` (10–128 chars), `confirmNewPassword` (must equal `newPassword`; UI-only field; `validation.passwordMismatch`). A static rules list shows "at least 10 characters" and "not a common password".
- **Submit:** `POST /api/auth/change-password`. On 200: replace the in-memory token, set `user` from the response, toast `account.password.changed`, navigate to `/`.
- **Errors → fields:** `CURRENT_PASSWORD_INCORRECT` → `currentPassword`; `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, `PASSWORD_TOO_COMMON`, `PASSWORD_SAME_AS_CURRENT` → `newPassword`.
- **Other actions:** "Log out" (calls logout, navigates to `/login`).

#### 7.3.3 `/` Dashboard
- **Data:** `GET /api/dashboard` (query key `['dashboard']`). Sections absent from the response are not rendered (Q12).
- **Components:**
  - Summary cards row (`grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`), each a `StatCard` with icon, label, `CountUp` value and a link:
    - "Pallets out" (`positions.palletsOut`, QuantityText) → `/reports/positions` when `reports.viewPositions`.
    - "Total owed" (`positions.owed`, MoneyText) → `/reports/positions?sort=-owed`.
    - "Total held" (`positions.held`, MoneyText) → `/reports/positions?sort=-held`.
    - "Low stock items" (`lowStock.count`) → `/items?lowStockOnly=true`; when count > 0 the card shows a warning icon (`TriangleAlert`) plus the text `dashboard.lowStock.attention`, and lists up to 5 item names with on-hand/min values.
  - Quick actions (large buttons, `h-14`): "New order" (`orders.create`, `Plus`) → `/orders/new`; "Record return" (`returns.create`, `Undo2`) → `/returns/new`; "Record payment" (`payments.create`, `Banknote`) → `/payments/new`.
  - "Recent activity" list (`recentActivity`, newest first, up to 10 rows): event kind icon + translated kind (`enums.activityEventKind.<KIND>`, from `ActivityEventDto.kind`; rows with `reversed = true` carry the `reversed` badge), order number, customer name, quantity or amount, business date. A row click opens `/orders/$orderId`.
- **Empty:** no recent activity → `dashboard.recent.empty`.

#### 7.3.4 `/orders` Orders list
- **Search params:** `status` (`OPEN` default, `SETTLED`, `CANCELLED`, `ALL`), `q`, `customerId`, `driverId`, `itemId`, `paymentType`, `dateFrom`, `dateTo`, `sort` (default `-orderNumber`), `page` (default 1), `pageSize` (default 25).
- **Data:** `GET /api/orders` with those params (key `['orders','list',params]`).
- **Components:** `Tabs` for status (OPEN / SETTLED / CANCELLED / ALL) above a `DataTable`; filter bar: search input (`q`, debounced 300 ms), customer, driver and item `EntityCombobox`, payment type `Select`, `DateRangePicker`.
- **Columns:** order number (`formatOrderNumber`), date, customer, driver, payment type (translated), deposit total, pallets out (`outQuantityTotal`), owed, out value, held, status (`StatusBadge`). Sortable: order number, date, owed, out value (mapped to `outValue`).
- **Actions:** "New order" (`orders.create`). Row click → `/orders/$orderId`.

#### 7.3.5 `/orders/new` New order — daily flow 1 (section 7.4.1)

#### 7.3.6 `/orders/$orderId` Order detail
- **Search params:** `created` (boolean, optional).
- **Data:** `GET /api/orders/:id` (key `['orders','detail',id]`).
- **Header:** order number (large), `StatusBadge`, customer (link to `/customers/$id`), driver (name, phone, car number), date, payment type, notes, owed, held, deposit total, pallets out. When `creditOverride` is not null: an info badge `orders.detail.creditOverridden` with `creditOverride.by.displayName` and `creditOverride.at`.
- **Created banner:** when `search.created` is true, a success banner at the top with `orders.detail.createdBanner` and a primary "Print receipt" button. Dismissing it removes the search param (`navigate({ search: {}, replace: true })`).
- **Lines table:** item (thumbnail + name), quantity, unit deposit, line total, returned accepted, damaged, still out.
- **Returns section:** one card per return, newest first: date, accepted/damaged per line, damaged refund, refund due, cash refund, notes, created by / at. Reversed returns are hidden by default. A "Show reversed" `Switch` reveals them with muted styling, a `reversed` badge (icon `Ban` + text) and, for edits, a link "replaced by return #id".
- **Money section:** ledger entries table: effective date, type (translated, with icon), source (translated), amount, note, created by. Reversal rows are separate rows, each with a "reverses #id" reference. The automatic hand-over payment carries the badge `payments.automatic`.
- **Actions** (toolbar; each needs its permission plus the stated state):
  - "Record return" — `returns.create`, status `OPEN`, `outQuantityTotal > 0` → `/returns/new?orderId=<id>`.
  - "Record payment" — `payments.create`, `paymentType = LENT`, `owed > 0`, not cancelled → `/payments/new?orderId=<id>`.
  - "Print receipt" — `orders.view`, not cancelled → `window.open('/print/orders/<id>', '_blank', 'noopener')`.
  - "Edit" — `orders.edit`, not cancelled → `/orders/$orderId/edit`.
  - "Cancel order" — `orders.cancel`, `canCancel = true` → `ConfirmDialog` (`orders.cancel.confirmTitle`, destructive) → `POST /api/orders/:id/cancel { version }`.
  - Per return (not reversed, order not cancelled): "Edit return" (`returns.edit`) → `/returns/new?orderId=<id>&replaceReturnId=<returnId>`; "Delete return" (`returns.delete`) → `ConfirmDialog` → `DELETE /api/returns/:id`.
  - Per ledger row that is a non-reversed MANUAL `PAYMENT`: "Delete payment" (`payments.delete`) → `ConfirmDialog` with an optional note textarea (0–500) → `POST /api/ledger-entries/:id/reverse { note }`.
- **States:** a cancelled order shows a muted banner `orders.detail.cancelledBanner` with cancelled-by and time, and no mutating actions.

#### 7.3.7 `/orders/$orderId/edit` Edit order
- **Data:** `GET /api/orders/:id`; driver combobox data; item combobox data (only when `canEditLines`).
- **Read-only display:** order number, customer, payment type (with the hint `orders.edit.immutableHint`: "To change the customer or payment type, cancel this order and create a new one").
- **Fields:** `driverId` (EntityCombobox drivers, required), `date` (DatePicker, max today, required), `notes` (0–1000). The lines editor (same component as in 7.4.1) is enabled only when `canEditLines`; otherwise the lines render read-only with the notice `orders.edit.linesLocked`. Existing lines show their stored `unitDeposit` (editable only with `orders.editUnitDeposit`); new lines take the item's current `depositPrice`.
- **Live summary:** new deposit total, delta versus the old total, credit check on a positive delta (same rules as 7.4.1). On CASH orders the summary shows `orders.edit.cashReissueNotice` ("the automatic payment will be re-issued for the new total").
- **Submit:** `PATCH /api/orders/:id` with `version` and only the changed fields. `lines` is sent only when the lines changed. Credit handling is the same as 7.4.1. On 200 → navigate to the detail page and toast `orders.edit.saved`.
- **Errors:** `ORDER_HAS_ACTIVITY` → toast, then refetch the detail (lines become locked). `ORDER_DATE_AFTER_ACTIVITY` → field `date`. `VERSION_CONFLICT` → reload dialog (section 7.7).

#### 7.3.8 `/returns/new` Record return — daily flow 2 (section 7.4.2)

#### 7.3.9 `/payments/new` Record payment — daily flow 3 (section 7.4.3)

#### 7.3.10 `/customers` Customers list
- **Search params:** `q`, `includeArchived` (default false), `hasOpenOrders` (optional boolean), `sort` (default `name`), `page`, `pageSize`.
- **Data:** `GET /api/customers`.
- **Columns:** name, phone, pallets out, out value, owed, held, credit limit (`customers.noLimit` when null), archived badge when archived. Sortable: name, owed, out value, held, created.
- **Filters:** search, "Only with open orders" `Switch`, "Include archived" `Switch`.
- **Actions:** "New customer" (`customers.create`). Row click → detail.

#### 7.3.11 `/customers/new` and `/customers/$customerId/edit` Customer form
- **Fields:** `name` (required, 1–200), `phone` (required, normalized per Q13 before validation, pattern `^\+?[0-9]{7,15}$`), `altPhone` (optional, same rule), `address` (required, 1–300), `creditLimit` (`MoneyInput`, optional: empty = no limit, `0` = may not take anything; helper text `customers.form.creditLimitHelp` explains both).
- **Live duplicate check:** after `phone` or `altPhone` changes and is valid, debounced 400 ms, `GET /api/customers/phone-check?phone=<p>&excludeId=<id when editing>`. Matches render an inline warning (warning icon + text `customers.form.phoneDuplicateWarning`) listing each match's name as a link.
- **Submit:** create `POST /api/customers`; edit `PATCH /api/customers/:id` with `version`. On `409 CUSTOMER_PHONE_DUPLICATE`, show `ConfirmDialog` (non-destructive variant) listing `details.matches`; "Save anyway" resubmits the same body with `confirmDuplicatePhone: true`.
- **Success:** navigate to the customer detail page; toast.

#### 7.3.12 `/customers/$customerId` Customer profile
- **Data:** `GET /api/customers/:id` (summary + holdings).
- **Summary cards:** pallets out (total, plus a per-item mini list), out value, owed, held, credit limit, and headroom (`creditLimit − outValue`). When `creditLimit` is null: `customers.noLimit`. When headroom < 0: the amount is shown with an `over limit` badge (icon + text).
- **Holdings table:** item (thumbnail + name), quantity out, then per source order a chip "#<orderNumber> · <date> · <qty>" linking to the order.
- **Tabs** (URL search param `tab`, default `history`); each tab renders only when `orders.view` is held:
  - `history` — `GET /api/customers/:id/history` paginated timeline: hand-overs, returns (accepted/damaged), money rows (payments, refunds, reversals), with dates and amounts. Reversed returns carry the `reversed` badge.
  - `orders` — `GET /api/orders?customerId=<id>&status=<tab status>` with its own status `Select` (default OPEN).
  - `payments` — `GET /api/ledger-entries?customerId=<id>&type=PAYMENT,PAYMENT_REVERSAL` (a comma list, §6.21).
  - `refunds` — `GET /api/ledger-entries?customerId=<id>&type=REFUND,REFUND_REVERSAL`.
- **Actions:** "New order" (`orders.create`, customer not archived) → `/orders/new?customerId=<id>`; "Edit" (`customers.edit`); "Archive" (`customers.delete`, not archived) → `ConfirmDialog` → `DELETE /api/customers/:id?version=N`. `CUSTOMER_HAS_OPEN_ORDERS` → toast.
- An archived customer shows a muted banner `customers.detail.archivedBanner`.

#### 7.3.13 `/drivers` Drivers
- **Search params:** `q`, `includeArchived`, `sort` (`name` default), `page`, `pageSize`.
- **Data:** `GET /api/drivers`.
- **Columns:** name, phone, car number, archived badge.
- **Create/edit:** a `Dialog` (not a route) with fields `name` (1–200), `phone` (normalized, pattern as customers), `carNumber` (1–50). Create → `POST /api/drivers`; edit → `PATCH /api/drivers/:id` with `version`. Optimistic update allowed (section 7.8).
- **Actions:** "New driver" (`drivers.create`), row "Edit" (`drivers.edit`), row "Archive" (`drivers.delete`, confirm).

#### 7.3.14 `/items` Items list
- **Search params:** `q`, `lowStockOnly`, `includeArchived`, `sort` (`name` default; `quantityOnHand`, `depositPrice`, `createdAt`), `page`, `pageSize`.
- **Data:** `GET /api/items`.
- **Columns:** thumbnail (40 × 40, `object-cover`, placeholder `Package` icon), name, deposit price, on hand, out with customers, damaged total, min stock, low-stock badge (`TriangleAlert` + `items.lowStock`), archived badge.
- **Actions:** "New item" (`items.create`). Row click → detail.

#### 7.3.15 `/items/new` and `/items/$itemId/edit` Item form
- **Fields:**
  - `name` (1–200).
  - Image: `ImageUploadField` — accepts `image/png,image/jpeg,image/webp`; client-side checks size ≤ 5 MB (`UPLOAD_MAX_BYTES`); uploads immediately with `POST /api/uploads?kind=ITEM_IMAGE` (multipart field `file`); shows the returned image; "Remove" sets `imageUploadId` to null.
  - `depositPrice` (`MoneyInput`, required, 0–`MONEY_INPUT_MAX`; edit form helper `items.form.depositPriceHelp`: "Changing the price never changes existing orders").
  - `minStock` (`QuantityInput`, optional, 0–`QUANTITY_INPUT_MAX`; empty = no warning).
- **Create only — initial stock** (rendered only with `purchases.create`): a `Switch` "Add initial stock" (off by default). When on: `initialBatch.date` (default today, max today), `initialBatch.quantity` (1–`QUANTITY_INPUT_MAX`), `initialBatch.unitCost` (`MoneyInput`, 0–max; the field is shown even without `items.viewCost` per Q17), `initialBatch.note` (0–500). Helper: `items.form.noInitialStockHelp` ("Without initial stock the item starts at 0").
- **Submit:** `POST /api/items` or `PATCH /api/items/:id` with `version`. Success → item detail.

#### 7.3.16 `/items/$itemId` Item detail
- **Data:** `GET /api/items/:id`; tab queries below.
- **Header:** image, name, deposit price, on hand, out with customers, damaged total, min stock, low-stock badge, archived banner.
- **Tabs** (search param `tab`):
  - `batches` (only with `purchases.view`): `GET /api/purchase-batches?itemId=<id>&sort=-date`. Columns: date, quantity, and — only when the response contains them (`items.viewCost`) — unit cost and total cost; note. No average cost anywhere. Row actions "Edit" (`purchases.edit`, dialog with date/quantity/unitCost/note and `version`) and "Delete" (`purchases.delete`, confirm, `DELETE /api/purchase-batches/:id?version=N`).
  - `movements` (default tab): `GET /api/items/:id/stock-movements`. Columns: time, reason (translated `enums.stockMovementReason.<R>`), signed quantity (green `+`/red `−` **plus** the sign character and an icon), reference (link to order or batch), note, user.
- **Actions:** "Add batch" (`purchases.create`, dialog: date default today, quantity, unitCost, note → `POST /api/purchase-batches`); "Adjust stock" (`items.adjustStock`, dialog: `quantity` signed integer ≠ 0 with |q| ≤ `QUANTITY_INPUT_MAX`, `note` required 3–500 → `POST /api/items/:id/stock-adjustments`); "Edit" (`items.edit`); "Archive" (`items.delete`, confirm).
- **Errors:** `STOCK_INSUFFICIENT` on batch edit/delete or on a negative adjustment → toast with `details` interpolated (requested, available).

#### 7.3.17 `/reports/*` Reports
Common: a filter bar, a `ReportTable` (a `DataTable` without pagination, with a sticky totals footer row), and a "Print" button (`window.print()`). The print stylesheet hides the AppShell chrome, filter controls and buttons, and prints the filter summary line (`reports.printedFilters`) above the table. Report queries use `staleTime: 0`. A tab strip at the top links the four reports the user may view.
- **Positions** (`GET /api/reports/positions`): no date range. Filter: customer (optional). Columns: customer, pallets out (total), out value, owed, held; rows expand (chevron button, `aria-expanded`) to per-item pallets out. Sortable client-side on every numeric column plus name (search param `sort`). Totals row: overall pallets out per item and sums.
- **Purchases** (`GET /api/reports/purchases`): `dateFrom` (default first day of the current Baghdad month), `dateTo` (default today), item (optional). Rows: item, date, quantity, unit cost, total; subtotal per item; overall total. The page exists only with `reports.viewPurchases` (which implies `items.viewCost`).
- **Activity** (`GET /api/reports/activity`): date range (same defaults), customer, item and driver filters. Sections, each its own table with totals: hand-overs, returns (accepted / damaged), payments, refunds, damage compensation assessed (label `reports.activity.compensationAssessed` with the note `reports.activity.compensationNote`). Reversal rows are listed as their own rows with a `reversal` badge. When the response has `moneyOmitted: true`, the payments/refunds sections are replaced by the notice `reports.activity.moneyOmitted`.
- **Stock** (`GET /api/reports/stock`): per item: on hand, out with customers, damaged total, min stock, low-stock flag (icon + text). Totals row.
- `DATE_RANGE_INVALID` → field error on `dateTo`.

#### 7.3.18 `/history` Audit log
- **Search params:** `userId` (admins only), `entityType`, `entityId`, `action`, `dateFrom`, `dateTo`, `page`, `pageSize`.
- **Data:** `GET /api/audit-logs`.
- **Filters:** user `EntityCombobox` rendered **only for admins** (its data comes from `GET /api/users`, which is admin-only); entity type `Select`; action `Select`; date range.
- **Columns:** time (`DateText` with time), user display name (or `usernameAttempt` in muted italics for failed logins), action (translated), entity type (translated), entity id (links to the entity page for ITEM, CUSTOMER, ORDER, USER — drivers have no page of their own; RETURN and LEDGER_ENTRY link to their order through `after.orderId` / `before.orderId`, as §11.4; each link only for a viewer who may open that page), summary (`t(summaryKey, summaryParams)`), IP.
- **Row expand:** a `AuditDiff` panel listing every top-level key present in `before` or `after` in a two-column table (before / after) with changed rows highlighted by background **and** a `•` marker. Values are rendered as text with `JSON.stringify(value, null, 2)` inside `<pre>`. Cost fields never appear (the server strips them).
- Read-only: no actions.

#### 7.3.19 `/users`, `/users/new`, `/users/$userId` User management (admin only)
- **List** (`GET /api/users`, params `q`, `role`, `isActive`): username, display name, role, active badge (icon + text), last login. Action "New user".
- **New** fields: `username` (lowercase `^[a-z0-9._-]{3,32}$`; the input lower-cases as the user types), `displayName` (1–100), `role` (`RadioGroup`, default `EMPLOYEE`), `password` (initial password, 10–128, with a "Generate" button producing 16 random characters from a readable alphabet via `crypto.getRandomValues`, shown in plain text for copying), `permissions` (`PermissionMatrix`, only when role is EMPLOYEE). Submit `POST /api/users` → navigate to `/users/$userId`. `USERNAME_TAKEN` → field `username`.
- **Detail/edit:**
  - Profile card: `displayName`, `role`, `isActive` (`Switch`) → `PATCH /api/users/:id` with `version`. Guard errors `SELF_DEACTIVATE_FORBIDDEN`, `SELF_DEMOTE_FORBIDDEN`, `LAST_ADMIN_GUARD` → toast; the controls for the admin's own account are disabled with a tooltip. Deactivation asks for confirmation.
  - Permissions card (EMPLOYEE only): `PermissionMatrix` + "Save permissions" → `PUT /api/users/:id/permissions { version, permissions }`. For ADMIN users the card shows `users.permissions.adminImplicit` and a fully checked, disabled matrix.
  - Security card: "Reset password" (dialog: new password with "Generate"; confirm) → `POST /api/users/:id/reset-password`; "Log out everywhere" (confirm) → `POST /api/users/:id/logout-all`.
- **`PermissionMatrix`:** one row per module (items, purchases, customers, drivers, orders, returns, payments, reports, audit); one checkbox per grantable key of that module, labelled `permissions.<key with "." replaced by "_">`. Ticking a key also ticks `closePermissionSet([key])`. Unticking a key also unticks every key whose closure contains it (the reverse closure computed from `PERMISSION_DEPENDENCIES`). Admin-only keys are listed in a separate read-only row `users.permissions.adminOnlyRow` with a lock icon. `PERMISSION_DEPENDENCY_MISSING` (cannot normally happen) → toast listing `details.missing`.

#### 7.3.20 `/settings` Settings (Q50)
- **Appearance** (every user; applied instantly and persisted to `localStorage` key `pallet.prefs.v1`; no server call): option cards, each a native radio in a `radiogroup` named by its section — light / dark / system with a miniature screen; colour theme with the same miniature in that theme; typeface with a Sorani and Latin specimen; text size with a field drawn at that size; then the language buttons.
- **Factory details** (admins only; the only part that calls the API):
- **Data:** `GET /api/settings`.
- **Fields:** `factoryName` (1–200), `phone` (1–100), `address` (1–300), logo (`ImageUploadField` with `kind=FACTORY_LOGO`; remove → null). Helper `settings.receiptHint` ("Shown on every printed receipt").
- **Submit:** `PUT /api/settings` with `version`. Success → toast; invalidate `['settings']`.

#### 7.3.21 `/account` My account
- **Profile** (read-only): username, display name, role.
- **Change password:** the same form as 7.3.2, embedded.
- **Preferences** live on `/settings` (§7.3.20, Q50). The top bar keeps a one-press light/dark toggle and a language menu.
- **Sessions:** "Log out everywhere" (confirm) → `POST /api/auth/logout-all`, then clear local auth and go to `/login`.

#### 7.3.22 `/print/orders/$orderId` Receipt (section 7.16)

#### 7.3.23 Not found / forbidden
`NotFoundPage`: `common.notFound.title`, text, and a "Go to dashboard" button. `ForbiddenPage`: `common.forbidden.title` ("You do not have permission to open this page"), text `common.forbidden.body` ("Ask an administrator for access"), and a "Go to dashboard" button.

### 7.4 The three daily flows (single screen each)

Rules shared by all three flows:
- Everything happens on one screen: pickers, form, live summary and submit. Choosing the customer or order never navigates away; the flow only updates search params with `navigate({ search, replace: true })`.
- Live values are computed on every keystroke with the pure functions of `@pallet/shared/domain/ledger-math` (`returnRefundDue`, `returnMoney`, `computeOrderTotals`, `checkCreditLimit`) from data already loaded. The client never re-implements the formulas. The server recomputes everything and is authoritative.
- Layout: on `≥ lg` a two-column grid `grid-cols-[1fr_22rem]` — the form at inline-start, a `sticky top-4` **Summary panel** at inline-end. Below `lg` the summary collapses into a sticky bottom bar (`fixed inset-x-0 bottom-0`) showing the key figure and the submit button; tapping the bar expands the full summary in a bottom `Sheet`.
- Submit button text: `orders.new.submit` / `returns.new.submit` / `payments.new.submit`. It is disabled while the mutation is pending and shows an inline 16 px spinner **inside** the button only.
- `Idempotency-Key` lifecycle (section 7.7.6).
- On success: toast (`<flow>.created`, interpolating the order number), invalidate caches (section 7.8.4), navigate to `/orders/$orderId` (flow 1 adds `search: { created: true }`).

#### 7.4.1 New order (`/orders/new`, search `customerId?`)

Fields, in DOM and tab order:

| # | Field | Component | Default | Validation (client = `OrderCreateBody`) |
|---|---|---|---|---|
| 1 | `customerId` | `EntityCombobox kind="customer"` (non-archived only), autofocus | `search.customerId` when present | required |
| 2 | `driverId` | `EntityCombobox kind="driver"` (non-archived only) | none | required |
| 3 | `date` | `DatePicker` (max = today in Asia/Baghdad, min = `2000-01-01`) | today (Asia/Baghdad) | required, `YYYY-MM-DD`, not in future |
| 4 | `paymentType` | `SegmentedRadio` with two large options "Paid cash" (`Banknote` icon) and "Lent" (`HandCoins` icon) | **none** (explicit choice required, because payment type is immutable after creation) | required |
| 5 | `lines[]` | `OrderLinesEditor` | one empty row | 1..50 rows (`OrderLines`, §6.19); each `itemId` required and unique within the order (`duplicate` on the repeated line, Q38); `quantity` integer 1..`QUANTITY_INPUT_MAX` |
| 6 | `notes` | `Textarea` (3 rows) | empty | 0..1000 chars |

`OrderLinesEditor` row: `EntityCombobox kind="item"` (thumbnail, name, on-hand and deposit price in the option row; excludes archived items and items already chosen in another row) · `QuantityInput` · unit deposit · line total (`MoneyText`, live) · remove button (`Trash2`, `aria-label` `orders.lines.remove`; hidden when only one row). Below the rows: "Add line" button (`Plus`). Pressing Enter in the last row's quantity input does **not** submit; it adds a new row and focuses its item picker (the only Enter override, documented in the field's `aria-describedby` hint).
- **Unit deposit:** displayed read-only as `MoneyText` from the item's `depositPrice`. Users with `orders.editUnitDeposit` see a `MoneyInput` prefilled with `depositPrice`; the request includes `unitDeposit` only for rows where the value differs from `depositPrice`. Rows without the permission never send `unitDeposit`.
- **Stock hint:** when `quantity > item.quantityOnHand` the quantity field shows the inline error `validation.stockExceeded` (params `available`) and submit is disabled. The server check (`STOCK_INSUFFICIENT`) remains authoritative; its `details.items[]` are mapped back onto the matching rows' quantity fields.

Data loaded:
- The customer combobox and item combobox queries (section 7.5).
- When a customer is chosen: `GET /api/customers/:id` (key `['customers','detail',id]`) for `creditLimit` and `outValue`.

Summary panel (live):

```
depositTotal       = Σ quantity × unitDeposit                         (MoneyText, large)
paymentLine        = CASH → "Customer pays now: depositTotal"   (orders.new.summary.paysNow)
                     LENT → "Customer will owe: depositTotal"   (orders.new.summary.willOwe)
creditLimit        = customer.creditLimit            (null → customers.noLimit)
currentOutValue    = customer.outValue
headroomBefore     = creditLimit − currentOutValue                   (only when creditLimit ≠ null)
headroomAfter      = headroomBefore − depositTotal
credit             = checkCreditLimit({ creditLimit, customerOutValue: currentOutValue, depositDelta: depositTotal })
```

- `credit.allowed = false` renders a destructive `Alert` `orders.new.creditExceeded` with params `limit`, `outValue`, `newTotal`, `excess` (all `formatMoney`).
  - **Employee:** the submit button is disabled while the alert shows.
  - **Admin:** the submit button text becomes `orders.new.submitWithOverride`. Pressing it opens `ConfirmDialog` (warning variant, title `orders.new.overrideTitle`, body with the same four numbers). Confirm sends the request with `confirmCreditOverride: true`.
- A `409 CREDIT_LIMIT_EXCEEDED` from the server (a concurrent order changed the out value) is handled the same way using `error.details` (`creditLimit`, `customerOutValue`, `depositDelta`, `excess`, `canOverride` — §4.4): employees see the alert; admins get the override dialog. The resubmission carries the **same** Idempotency-Key only if the body is unchanged apart from `confirmCreditOverride` — per 7.7.6 a changed body produces a new key, which is correct because the failed attempt stored nothing.
- Archived customer, driver or item errors (`CUSTOMER_ARCHIVED`, `DRIVER_ARCHIVED`, `ITEM_ARCHIVED`) → toast and invalidate the matching combobox query.

Worked example (must match the Playwright flow test): items A (deposit 1,000, on hand 500) and B (deposit 2,500, on hand 40); lines A × 100 and B × 10 → depositTotal = 100 × 1,000 + 10 × 2,500 = 125,000. Customer with creditLimit 300,000 and outValue 200,000 → headroomBefore 100,000, headroomAfter −25,000, `checkCreditLimit` → `{ allowed: false, excess: 25,000 }`.

#### 7.4.2 Record return (`/returns/new`, search `orderId?`, `replaceReturnId?`, `customerId?`)

Screen sections, top to bottom, all on one page:

1. **Order picker** (shown when `orderId` is absent): `EntityCombobox kind="customer"` (includes archived customers, since returns on their open orders remain allowed) → then a list of that customer's orders from `GET /api/orders?customerId=<id>&status=OPEN&pageSize=100`, filtered client-side to `outQuantityTotal > 0`, rendered as selectable cards (order number, date, payment type, pallets out, owed). Selecting a card sets `search.orderId`. When exactly one order qualifies it is selected automatically.
2. **Order header** (compact): order number, customer, date, payment type, owed, pallets out; a "Change order" link clears `orderId`.
3. **Return form.**

Data: `GET /api/orders/:orderId` (lines, returns, ledger, owed, version).

Replace mode (`replaceReturnId` present, requires `returns.edit`): the baseline state is computed client-side as "the order as if that return were reversed":

```ts
const base: OrderState = toOrderState(order)             // from the detail DTO
const replaced = base.returns[indexOf(replaceReturnId)]
const baseline: OrderState = {
  ...base,
  returns: base.returns.map(r => r.id === replaceReturnId ? { ...r, reversed: true } : r),
  ledger: replaced.cashRefund > 0
    ? [...base.ledger, { type: 'REFUND_REVERSAL', amount: replaced.cashRefund }]
    : base.ledger,
}
const baseTotals = computeOrderTotals(baseline)
```

In normal mode `baseTotals = computeOrderTotals(toOrderState(order))`. The form fields are prefilled from the replaced return's lines in replace mode, and zero otherwise.

Fields:

| Field | Component | Default | Validation |
|---|---|---|---|
| `date` | `DatePicker` (min = order date, max = today) | today; in replace mode the replaced return's date | required; ≥ order date (`RETURN_DATE_BEFORE_ORDER_DATE`) |
| per line `acceptedQuantity` | `QuantityInput` (allows 0) | 0 | integer ≥ 0 |
| per line `damagedQuantity` | `QuantityInput` (allows 0) | 0 | integer ≥ 0 |
| per line `damagedRefund` | `MoneyInput` (disabled while `damagedQuantity = 0`, then forced to 0) | 0 | 0 ≤ value ≤ damagedQuantity × unitDeposit (`DAMAGED_REFUND_TOO_HIGH`) |
| row rule | — | — | accepted + damaged ≤ `baseTotals.lines[i].outQuantity` (`validation.returnExceedsOut`, params `out`) |
| form rule | — | — | at least one row with accepted + damaged > 0 (`RETURN_EMPTY`) |
| `notes` | `Textarea` | empty / replaced return's notes | 0..1000 |

Only order lines with `baseTotals.lines[i].outQuantity > 0` are rendered as rows (in replace mode: lines that are out after the baseline). Each row shows item thumbnail + name, "out: N", unit deposit, the three inputs, and a quick button "All accepted" that sets accepted = out, damaged = 0, refund = 0. Above the rows, a quick button "Everything returned accepted" applies that to every row. Only rows with accepted + damaged > 0 are sent in `lines[]`.

Summary panel (live):

```
refundDue  = returnRefundDue(rows.map(r => ({ acceptedQuantity, unitDeposit, damagedRefund })))
owedBefore = baseTotals.owed
{ cashRefund, owedAfter } = returnMoney(owedBefore, refundDue)
outAfter   = baseTotals.outQuantityTotal − Σ (accepted + damaged)
compensationThisReturn = Σ (damagedQuantity × unitDeposit − damagedRefund)
```

- Shown rows: refund due, owed before, owed after, pallets still out after, compensation assessed by this return.
- When `cashRefund > 0`: a prominent success-colored block (icon `HandCoins` + text) `returns.new.cashHandover` — "Hand the customer {{amount}} IQD now". Recording the return asserts the cash was handed over (A4).
- When `cashRefund = 0` and `owedAfter > 0`: info line `returns.new.stillOwes` with `owedAfter`.

Worked example (LENT 100 × 1,000, paid 40,000, returning 50 accepted): refundDue 50,000; owedBefore 60,000; cashRefund 0; owedAfter 10,000; outAfter 50.

Submit:
- normal mode → `POST /api/orders/:orderId/returns` with `Idempotency-Key`;
- replace mode → `POST /api/returns/:replaceReturnId/replace` (same body; no `Idempotency-Key`).

Errors: `RETURN_EXCEEDS_OUT` (details per `orderLineId`) → row field errors after refetching the order; `RETURN_ALREADY_REVERSED` → toast, then navigate to the order; `ORDER_CANCELLED` → toast.

#### 7.4.3 Record payment (`/payments/new`, search `orderId?`, `customerId?`)

1. **Order picker** (when `orderId` is absent): customer combobox → that customer's orders from `GET /api/orders?customerId=<id>&status=OPEN&paymentType=LENT&pageSize=100`, filtered to `owed > 0`, as selectable cards (order number, date, owed). Auto-select when exactly one.
2. **Form** (data: `GET /api/orders/:orderId`):

| Field | Component | Default | Validation |
|---|---|---|---|
| `amount` | `MoneyInput`, autofocus | the order's full `owed` | integer 1..`owed` (`PAYMENT_EXCEEDS_OWED`, params `owed`) |
| `date` | `DatePicker` (min = order date, max = today) | today | required (`PAYMENT_DATE_BEFORE_ORDER_DATE`) |
| `note` | `Input` | empty | 0..500 |

Quick buttons below amount: "Full amount" (sets owed) and "Half" (sets ⌊owed / 2⌋, rendered only when owed ≥ 2).

Summary panel: owed before = `order.owed`; payment = `amount`; owed after = `owed − amount`. When owed after is 0 and pallets out is 0: `payments.new.willSettle` ("This order will be settled").

Submit: `POST /api/orders/:orderId/payments` with `Idempotency-Key`. Errors: `PAYMENT_ORDER_NOT_LENT`, `ORDER_CANCELLED` → toast; `PAYMENT_EXCEEDS_OWED` → refetch the order and set a field error on `amount` with the new `owed`.

### 7.5 Shared application components (`src/components/app/`)

| Component | File | Contract |
|---|---|---|
| `AppShell` | `app-shell.tsx` | Skip link "Skip to content" (first focusable, `sr-only focus:not-sr-only`); `≥ lg`: fixed sidebar `w-64` at inline-start (`border-e`) with nav items (icon + label, active item `bg-accent` plus `aria-current="page"`), the user menu at the bottom (display name, role; "My account", "Log out"); `< lg`: top bar `h-14` with a menu button opening a `Sheet side="start"`, the page title and the user menu. `<main id="main" tabIndex={-1}>` wraps `<AnimatedOutlet/>` (section 7.14). Content max width `max-w-7xl`, padding `px-4 sm:px-6 lg:px-8`. |
| `PageHeader` | `page-header.tsx` | `title`, optional `description`, `actions` slot (inline-end), optional breadcrumb. `<h1>` is the title. |
| `DataTable<T>` | `data-table.tsx` | Props: `columns: DataColumn<T>[]` (`id`, `header` i18n key, `cell`, `sortKey?`, `align?: 'start' | 'end'`, `hideBelow?: 'md' | 'lg'`, `mobile?: 'title' | 'subtitle' | 'meta' | 'hidden'`), `rows`, `total`, `page`, `pageSize`, `sort`, `onSortChange`, `onPageChange`, `onRowClick?`, `search?` (value + onChange), `filters?` slot, `isFetching`, `empty` node. Header row `sticky top-0 z-10 bg-background` inside a `ScrollArea` with `max-h-[calc(100dvh-14rem)]`. Sort: clickable header buttons with `aria-sort` and `ArrowUp`/`ArrowDown` icons; cycling asc → desc → default. Pagination: shadcn `Pagination` with previous/next plus "page X of Y" and a page-size `Select` (10, 25, 50, 100). Row click: the whole row is clickable (`cursor-pointer`), and the first cell contains a real `<Link>` for keyboard and middle-click. `< md`: the table is replaced by a list of `Card`s, one per row, using the columns' `mobile` roles. While `isFetching` with existing rows: a 2 px indeterminate bar above the header (no skeleton). Numeric columns use `align="end"` and `tabular-nums`. |
| `EntityCombobox` | `entity-combobox.tsx` | `kind: 'customer' | 'driver' | 'item' | 'user'`, `value: number | null`, `onChange`, `includeArchived?`, `excludeIds?`, `disabled?`, `invalid?`. A shadcn `Popover` + `Command`. Typing debounces 250 ms and queries the list endpoint with `q` and `pageSize=20` (`['<module>','list',{q, pageSize:20, includeArchived}]`). Options: customer → name + phone; driver → name + car number; item → 32 × 32 thumbnail + name + "on hand N · deposit X"; user → display name + username. The selected entity renders in the trigger (item with thumbnail). Keyboard: typing opens it, arrows move, Enter selects, Esc closes. |
| `MoneyText` | `money-text.tsx` | `value: number`, `size?`. Renders `<span dir="ltr" className="tabular-nums">{formatMoney(value)}</span>` followed by a space and `t('common.currency')` in a separate span. Negative values never occur; `0` renders as `0`. |
| `QuantityText` | `quantity-text.tsx` | `<span dir="ltr" className="tabular-nums">{formatNumber(value)}</span>`. |
| `DateText` | `date-text.tsx` | `value: string` (business date `YYYY-MM-DD`) or ISO timestamp; `withTime?`. Renders `<time dateTime={value} dir="ltr">` with `formatBusinessDate` (business dates) / `formatTimestamp` (timestamps) (Asia/Baghdad). |
| `StatusBadge` | `status-badge.tsx` | `status: OrderStatus`. OPEN → `CircleDot` + `enums.orderStatus.OPEN`, info tokens; SETTLED → `CircleCheck` + text, success tokens; CANCELLED → `Ban` + text, muted tokens. Always icon plus text. |
| `ConfirmDialog` | `confirm-dialog.tsx` | shadcn `AlertDialog`. Props: `title`, `description`, `confirmLabel`, `variant: 'destructive' | 'warning' | 'default'`, `onConfirm: () => Promise<void>`, `children?` (extra fields such as a note). The confirm button shows pending state; the dialog closes on success and stays open with an inline error on failure. The cancel button is focused by default for destructive variants. |
| `EmptyState` | `empty-state.tsx` | Icon (lucide, 40 px, muted), title, description, optional action button. |
| `PageSkeleton` | `page-skeleton.tsx` | `variant: 'list' | 'detail' | 'form' | 'report' | 'dashboard'`. Built from shadcn `Skeleton` blocks shaped like the final layout. |
| `QueryErrorState`, `NotFoundState` | `query-error-state.tsx` | See section 7.3 common rules. |
| `CountUp` | `count-up.tsx` | `value`, `format: 'money' | 'number'`. Uses `useCountUp` (section 7.14). |
| `StatCard` | `stat-card.tsx` | Icon, label, `CountUp`, optional link (whole card is a link with a visible focus ring). |
| `FormFooter` | `form-footer.tsx` | Sticky footer bar in forms: "Cancel" (navigates back or to the list) and the submit button (`type="submit"`), disabled while pending. |
| `SummaryPanel` | `summary-panel.tsx` | The daily-flow summary described in 7.4 (sticky side panel / bottom bar with `Sheet`). |
| `MoneyInput` / `QuantityInput` | `numeric-input.tsx` | `<Input inputMode="numeric" dir="ltr" autoComplete="off">`. On input: converts Eastern Arabic (`٠-٩`) and Persian (`۰-۹`) digits to Western (`toWesternDigits`), strips everything except digits (plus a leading `-` when `allowNegative`), re-renders with thousands separators, and keeps the caret position. The value in form state is `number | null` (null = empty). |
| `DatePicker`, `DateRangePicker` | `date-picker.tsx` | Trigger shows `dd/MM/yyyy`; popover with shadcn `Calendar` (react-day-picker 10, `dir` from preferences, `weekStartsOn={6}` for Saturday, month/weekday names from i18n keys `common.months.1..12`, `common.weekdaysShort.0..6`, Western digits); `min`/`max` disable days. Typing is also supported: the trigger is an input accepting `dd/MM/yyyy` (digits normalized). Value is the business date string `YYYY-MM-DD`. |
| `SegmentedRadio` | `segmented-radio.tsx` | Radix `RadioGroup` styled as large option cards (icon + label), arrow-key navigation respecting direction. |
| `ImageUploadField` | `image-upload-field.tsx` | See 7.3.15; upload progress via `XMLHttpRequest.upload.onprogress` wrapped in the api client helper `apiUpload`; errors `UPLOAD_*` shown inline. |
| `PermissionMatrix` | `permission-matrix.tsx` | See 7.3.19. |
| `LanguageSwitcher`, `ThemeToggle` | `preferences-controls.tsx` | Controls bound to `PreferencesProvider`. |
| `AuditDiff` | `audit-diff.tsx` | See 7.3.18. |
| `ForbiddenPage`, `NotFoundPage`, `ErrorPage`, `BootScreen` | `system-pages.tsx` | See 7.1 and 7.3.23. |

### 7.6 Client state

- **Server state:** TanStack Query only. No Redux/Zustand.
- **Auth store** (`src/lib/auth.ts`): a module-level object `{ accessToken: string | null, accessTokenExpiresAt: number | null, user: MeDto | null, status: 'booting' | 'authenticated' | 'anonymous' }` with `subscribe`/`getSnapshot`, consumed with `useSyncExternalStore` through `useAuth()`. The access token is **never** written to `localStorage`, `sessionStorage`, IndexedDB or cookies. `useCan(key)` returns `auth.can(key)`.
- **`me` refresh:** after any `PERMISSION_DENIED` or `ADMIN_ONLY` response, and on window focus when the last `me` fetch is older than 60 s, the client calls `GET /api/auth/me` and replaces `user`. Permission changes therefore show up without logging out (the API is still the authority).
- **Preferences:** `PreferencesProvider` (`src/lib/preferences.ts`) holds `{ language, theme, fontSize }`. Every change writes `localStorage['pallet.prefs.v1']` (in try/catch) and applies it to `<html>` exactly as `boot-prefs.js` does. A language change also calls `i18n.changeLanguage(lang)`.

### 7.7 API client (`src/lib/api-client.ts`, `src/lib/refresh-lock.ts`)

#### 7.7.1 `apiFetch`
```ts
apiFetch<T>(path: string, options?: {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | (string | number)[] | undefined | null>;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  skipAuthRetry?: boolean;         // true for login, refresh and logout — the calls that carry no access token;
                                   // me, logout-all and change-password refresh and retry like any authenticated call
}): Promise<T>
```
- URL = `'/api' + path` plus the query string (`undefined`/`null` omitted; arrays repeated as `type=A&type=B`; booleans `true`/`false`).
- Headers: `Accept: application/json`; `Content-Type: application/json` when `body` is present; `X-Requested-With: pallet-web` on every non-GET request; `Authorization: Bearer <token>` when a token exists; `Idempotency-Key` when given.
- `credentials: 'same-origin'` (the refresh cookie is path-scoped to `/api/auth`, so it is only sent to auth endpoints).
- 204 → resolves `undefined`. 2xx → parsed JSON.
- Non-2xx → parse `ApiErrorBody` and throw `ApiError { status, code, details, fields, requestId }`. An unparsable body throws `ApiError` with code `UNKNOWN_ERROR`. A `fetch` rejection (offline) throws `ApiError` with code `NETWORK_ERROR` and status 0. `UNKNOWN_ERROR` and `NETWORK_ERROR` are **client-only** codes; they have i18n keys `errors.UNKNOWN_ERROR` and `errors.NETWORK_ERROR` and are part of the completeness test.

#### 7.7.2 Refresh-once-then-retry
When a response is 401 with code `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_INVALID` or `AUTH_REQUIRED`, and `skipAuthRetry` is not set: `await refreshAccessToken()`; on success retry the original request exactly once (same idempotency key). If the refresh fails, or the retry returns 401 again: `auth.clear()`, `queryClient.clear()`, and navigate to `/login?redirect=<current href>`.

Proactive refresh: `auth.ts` schedules `refreshAccessToken()` 60 s before `accessTokenExpiresAt` while `document.visibilityState === 'visible'`. On `visibilitychange` to visible, if the token expires in under 60 s, it refreshes immediately.

#### 7.7.3 `refreshAccessToken()` and cross-tab serialization
- **Per-tab single flight:** a module-level `inflight: Promise<boolean> | null`; concurrent callers await the same promise.
- **Cross-tab (primary):** when `'locks' in navigator`: `navigator.locks.request('pallet-auth-refresh', { mode: 'exclusive' }, () => doRefresh())`. Each tab refreshes its own token, but the tabs do it one after another, so cookie rotation never races.
- **Cross-tab (fallback, no Web Locks):** BroadcastChannel `pallet-auth`. Before refreshing, a tab checks `peerBusyUntil` (set from received `{ type: 'refresh-start', at }` messages to `at + 3000`). If `Date.now() < peerBusyUntil` it waits until it receives `{ type: 'refresh-end' }` or until `peerBusyUntil` passes, whichever is first. It then posts `{ type: 'refresh-start', at: Date.now() }`, performs `doRefresh()`, and posts `{ type: 'refresh-end' }` in `finally`. If `BroadcastChannel` is also missing, it refreshes directly (the server grace window covers the race).
- **`doRefresh()`:** `POST /api/auth/refresh` with `X-Requested-With`, no Authorization header, `skipAuthRetry: true`. 200 → store `accessToken`, `accessTokenExpiresAt`, `user`; resolve true. 401 → resolve false.
- A receipt opened in a new tab (`window.open`) boots, refreshes through the same lock, and is covered by the server's 30 s grace window if two refreshes overlap.

#### 7.7.4 Error handling (`src/lib/errors.ts`, `src/hooks/use-api-error-handler.ts`)
`handleApiError(error, { form?, fieldMap? })` applies these rules in order:
1. `VALIDATION_FAILED` with `fields` → `form.setError(path, { type: code, message: 'validation.' + code })` for every field whose path is registered in the form; the remaining ones go into one toast.
2. When `fieldMap[code]` exists (per form; the change-password form uses `{ CURRENT_PASSWORD_INCORRECT: 'currentPassword' }`) → `form.setError(fieldMap[code], { message: 'errors.' + code })`.
3. `VERSION_CONFLICT` → opens the global `VersionConflictDialog` ("This record was changed by someone else. Reload to see the latest version.") with the actions "Reload" (invalidate the entity's detail query and reset the form from fresh data) and "Keep editing" (close).
4. `PASSWORD_CHANGE_REQUIRED` → navigate to `/change-password`.
5. `PERMISSION_DENIED`, `ADMIN_ONLY` → toast, then refresh `me`.
6. Anything else → `toast.error(t('errors.' + code, error.details))`. Every `errors.*` string may interpolate keys from `details`; numbers in `details` are passed through `formatNumber` first.

Mutations never swallow errors silently. Every mutation hook passes `onError: (e) => handleApiError(e, ctx)` unless the page handles the code explicitly (credit limit, duplicate phone).

#### 7.7.5 Uploads
`apiUpload(kind, file, onProgress)` uses `XMLHttpRequest` (for progress) with the same headers (`Authorization`, `X-Requested-With`) and `FormData` field `file`. It returns `UploadDto { id, url, width, height }`. On 401 it runs the same refresh-once logic.

#### 7.7.6 Idempotency key lifecycle (`src/lib/idempotency.ts`)
`useIdempotencyKey()` returns `getKey(payload)`:
- It keeps `{ key, payloadHash }` in a ref. `payloadHash` = canonical JSON of the payload (keys sorted recursively).
- `getKey(payload)`: when there is no stored key or `payloadHash` differs from the stored one → new `crypto.randomUUID()` stored with the new hash; otherwise the stored key is returned.
- The key is dropped on success (the page navigates away).

Consequences: a double-click, a network retry or the automatic retry after a token refresh reuse the same key and get the original result. A corrected resubmission (changed quantities, `confirmCreditOverride: true`) gets a new key. The server stores nothing for failed attempts, so either way the result is correct.

### 7.8 TanStack Query conventions (`src/lib/query-client.ts`, `src/lib/query-keys.ts`)

#### 7.8.1 Client defaults
```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: 0 },
  },
})
```
Overrides: `['me']` staleTime 0 (fetched explicitly); `['settings']` 5 min; `['dashboard']` 15 s; `['reports', …]` 0; combobox lists 60 s.

#### 7.8.2 Query keys (factory `qk` in `query-keys.ts`)
| Key | Endpoint |
|---|---|
| `['me']` | `GET /api/auth/me` |
| `['settings']` | `GET /api/settings` |
| `['dashboard']` | `GET /api/dashboard` |
| `['users','list',params]`, `['users','detail',id]` | users |
| `['items','list',params]`, `['items','detail',id]`, `['items','movements',id,params]` | items |
| `['purchases','list',params]` | `GET /api/purchase-batches` |
| `['customers','list',params]`, `['customers','detail',id]`, `['customers','history',id,params]`, `['customers','phoneCheck',phone,excludeId]` | customers |
| `['drivers','list',params]`, `['drivers','detail',id]` | drivers |
| `['orders','list',params]`, `['orders','detail',id]`, `['orders','receipt',id]` | orders |
| `['ledger','list',params]` | `GET /api/ledger-entries` |
| `['reports', 'positions' | 'purchases' | 'activity' | 'stock', params]` | reports |
| `['audit','list',params]` | `GET /api/audit-logs` |

#### 7.8.3 Loaders
Route loaders call `queryClient.ensureQueryData(...)` for the page's primary query, so navigation from a list to a detail page renders without a skeleton when the data is prefetched (`defaultPreload: 'intent'`).

#### 7.8.4 Invalidation map (applied in each mutation's `onSuccess`)
| Mutation | Invalidate (prefix match) |
|---|---|
| order create / edit / cancel | `['orders']`, `['customers','detail',customerId]`, `['customers','history',customerId]`, `['customers','list']`, `['items']`, `['ledger']`, `['dashboard']`, `['reports']` |
| return create / replace / delete | same as order edit |
| payment create / reverse | `['orders','detail',orderId]`, `['orders','list']`, `['customers','detail',customerId]`, `['customers','history',customerId]`, `['customers','list']`, `['ledger']`, `['dashboard']`, `['reports']` |
| item create / edit / archive, stock adjustment | `['items']`, `['dashboard']`, `['reports']` |
| batch create / edit / delete | `['purchases']`, `['items','detail',itemId]`, `['items','movements',itemId]`, `['items','list']`, `['dashboard']`, `['reports']` |
| customer create / edit / archive | `['customers']` |
| driver create / edit / archive | `['drivers']` |
| user create / edit / permissions / reset / logout-all | `['users']`; when the target is the current user also refetch `['me']` |
| settings update | `['settings']` |
| change own password, logout-all (self) | handled by the auth store |

#### 7.8.5 Optimistic updates
Allowed **only** for driver create, driver edit and driver archive in the `['drivers','list', …]` caches (snapshot in `onMutate`, rollback in `onError`, invalidate in `onSettled`). Everything that touches stock, money, permissions or users waits for the server response. Destructive dialogs keep the pending state until the server answers.

### 7.9 Forms and validation

- Every form uses `useForm({ resolver: zodResolver(Schema), defaultValues, mode: 'onTouched' })`. `Schema` is the shared request schema from `@pallet/shared` (section 8.5), extended in the web app only for UI-only fields (`confirmNewPassword`, the `addInitialStock` switch) with `.extend()` / `.superRefine()`.
- Form-level zod error messages are **i18n keys**, not prose. `src/lib/zod-i18n.ts` installs `z.config({ customError })`, which maps each issue with `zodIssueToFieldError` (section 8.5) and returns the message `validation.<code>`, storing params in the issue. `<FieldError>` renders `t(message, params)`.
- Field components: shadcn `field` primitives (`Field`, `FieldLabel`, `FieldDescription`, `FieldError`). Every input has a visible label bound with `htmlFor`/`id`. Errors are linked with `aria-describedby` and set `aria-invalid`.
- Enter submits (native `<form onSubmit>`), except the documented order-lines exception (7.4.1). The submit button has `type="submit"`, so pending state disables it.
- Numbers: `MoneyInput` / `QuantityInput` only (7.5).
- Dates: `DatePicker` only; values are business date strings.
- Defaults: today (Asia/Baghdad) for dates, the item deposit price for unit deposit, the order's owed for payment amount, 0 for return quantities.
- **Unsaved changes guard:** forms with `formState.isDirty && !isSubmitSuccessful` register TanStack Router `useBlocker({ shouldBlockFn })`, which opens a `ConfirmDialog` (destructive, `common.unsavedChanges`) before leaving.
- The trimming of text inputs is done by the shared schemas (`z.string().trim()`), so the server and client agree.

### 7.10 Internationalization

- **Setup** (`src/i18n/index.ts`): `i18next.use(initReactI18next).init({ resources: { ckb: { translation: ckb }, ar: { translation: ar }, en: { translation: en } }, lng, fallbackLng: false, supportedLngs: ['ckb','ar','en'], interpolation: { escapeValue: false }, returnNull: false, returnEmptyString: false, react: { useSuspense: false } })`. `fallbackLng: false` guarantees no silent English fallback. In development `missingKeyHandler` logs `console.error('[i18n] missing', lng, key)`.
- **Files:** `src/i18n/locales/ckb.json`, `ar.json`, `en.json`. They are nested JSON objects with a single namespace `translation`. The baseline files hold only scaffold keys (`app.name`, `common.currency`, `home.*`, `status.*`, `preferences.*`, `notFound.*`) used by the baseline home page; milestone 1 replaces that page and renames them to this section's convention (`common.appName`, `common.currency`, `account.preferences.*`, `common.notFound.*`) and deletes `home.*` and `status.*`.
- **Typed keys:** `src/i18n/i18next.d.ts` declares `CustomTypeOptions { defaultNS: 'translation'; resources: { translation: typeof en } }`, so `t('orders.list.title')` is type-checked against `en.json`.
- **Key convention:** `<area>.<subarea>.<name>`, camelCase segments. Areas: `common`, `nav`, `auth`, `dashboard`, `orders`, `returns`, `payments`, `customers`, `drivers`, `items`, `purchases`, `reports`, `history`, `users`, `settings`, `account`, `receipt`, `enums.<enumName>.<VALUE>` (enumName camelCase: `role`, `paymentType`, `orderStatus`, `stockMovementReason`, `ledgerEntryType`, `ledgerEntrySource`, `auditAction`, `auditEntityType`, `activityEventKind`, `customerHistoryKind`), `errors.<ERROR_CODE>` (every `ErrorCode` plus `NETWORK_ERROR`, `UNKNOWN_ERROR`), `validation.<ValidationCode>` plus the UI-only keys `validation.passwordMismatch`, `validation.stockExceeded`, `validation.returnExceedsOut`, `permissions.<key with "." replaced by "_">` (all 36 keys), `audit.summary.<AuditEntityType>.<AuditAction>` for every combination the API emits (list in section 11).
- **No plural keys:** counts are always phrased as "Label: {{count}}", so no language needs plural categories (Arabic has six). Keys ending in `_one`, `_other`, `_zero`, `_two`, `_few` or `_many` are forbidden.
- **Numbers and dates are never formatted by i18next.** They are pre-formatted with `@pallet/shared` format helpers (Western digits) and passed as strings.
- **Completeness test** (`src/i18n/locales.test.ts`, vitest) fails the build when:
  1. the flattened key sets of `ckb`, `ar` and `en` are not identical;
  2. any value is an empty string;
  3. any `ErrorCode`, `ValidationCode`, enum value, permission key, or audit summary key from `@pallet/shared` lacks a key;
  4. any `ckb` or `ar` value contains a Latin letter `[A-Za-z]` outside `{{placeholders}}`, except keys listed in `LATIN_ALLOWED_KEYS = ['common.currencyCode', 'common.appNameLatin', 'account.language.en']`;
  5. any `ckb` value equals the `en` value, or any `ar` value equals the `en` value, for strings with 3 or more characters (catches copy-pasted English);
  6. a forbidden plural suffix is present;
  7. the set of `{{placeholders}}` in a key differs between languages.
- **Language names:** `account.language.ckb` = `کوردی (سۆرانی)`, `account.language.ar` = `العربية`, `account.language.en` = `English` — each identical in all three files (the Latin check allowlists `account.language.en`).
- **Proofreading (Q22):** all `ckb` and `ar` strings are written by the builder and must be proofread by a native speaker at the client before go-live (acceptance checklist in section 15).

### 7.11 Right-to-left rules

- `dir` on `<html>` is `rtl` for `ckb` and `ar`, `ltr` for `en`. It is set by `boot-prefs.js` and by `PreferencesProvider` on change, at runtime without a reload. Radix components receive the direction through `Direction.Provider` (from `radix-ui`) so that keyboard arrows, menus, radio groups, tabs, sliders and scroll areas behave correctly.
- **Logical properties only.** Tailwind utilities with physical sides are forbidden in `apps/web/src/**/*.tsx` and `*.css`. Substitution table:

| Forbidden (physical) | Required (logical) |
|---|---|
| `ml-*`, `mr-*` | `ms-*`, `me-*` |
| `pl-*`, `pr-*` | `ps-*`, `pe-*` |
| `left-*`, `right-*` | `start-*`, `end-*` |
| `inset-l-*`, `inset-r-*` | `start-*`, `end-*` |
| `text-left`, `text-right` | `text-start`, `text-end` |
| `rounded-l-*`, `rounded-r-*`, `rounded-tl-*`, `rounded-tr-*`, `rounded-bl-*`, `rounded-br-*` | `rounded-s-*`, `rounded-e-*`, `rounded-ss-*`, `rounded-se-*`, `rounded-es-*`, `rounded-ee-*` |
| `border-l`, `border-r`, `border-l-*`, `border-r-*` | `border-s`, `border-e`, `border-s-*`, `border-e-*` |
| `space-x-*` | `gap-*` on a flex/grid container |
| `float-left`, `float-right` | `float-start`, `float-end` |
| `slide-in-from-left`, `slide-in-from-right`, `slide-out-to-left`, `slide-out-to-right` | pair with `ltr:`/`rtl:` variants (`ltr:slide-in-from-left rtl:slide-in-from-right`) |
| `translate-x-*` used for positioning or toggles | keep it and add the mirrored `rtl:-translate-x-*` counterpart |
| CSS `margin-left`, `padding-right`, `left:`, `right:`, `text-align: left/right` | `margin-inline-start`, `padding-inline-end`, `inset-inline-start`, `inset-inline-end`, `text-align: start/end` |

- **Enforcement** (patterns as refined by Q43): the vitest test `src/test/rtl-classes.test.ts` scans every `.tsx`/`.ts`/`.css` file under `src/` (excluding `routeTree.gen.ts` and the receipt stylesheet, whose layout is mm-based and fixed RTL) with the regex `/(?<![\w-])(-?(ml|mr|pl|pr|left|right|inset-l|inset-r|rounded-[tb]?[lr]|border-[lr]|space-x|float-left|float-right|text-left|text-right)(-[\w./[\]]+)?)(?![\w-])/`. It fails on any match not followed on the same line by the comment `// rtl-ok: <reason>`.
- **Directional icons flip:** `ChevronLeft`, `ChevronRight`, `ChevronsLeft`, `ChevronsRight`, `ArrowLeft`, `ArrowRight`, `ArrowLeftRight` (not flipped), `Undo2`, `Redo2`, `LogOut`, `LogIn`, `CornerDownLeft`, `CornerDownRight` get `className="rtl:-scale-x-100"`. They are wrapped as `DirIcon` components in `src/components/app/dir-icon.tsx`. Icons that do not imply direction (`Plus`, `Trash2`, `Package`) never flip.
- **Numbers, phone numbers, dates, order numbers and car numbers** are always wrapped in an element with `dir="ltr"` (`MoneyText`, `QuantityText`, `DateText`, `<bdi dir="ltr">` for phones and car numbers). This keeps `dd/MM/yyyy` and `+964 750 …` from being reordered inside RTL text. Numeric inputs are `dir="ltr"` with `text-end` alignment in RTL (`rtl:text-end`, which reads as right-aligned).
- **Mixed text:** user data (names, notes) is rendered with `dir="auto"` in table cells and headings so Latin-script names in a Sorani UI align correctly.
- **Sheets and side panels:** our `Sheet` wrapper accepts `side: 'start' | 'end' | 'top' | 'bottom'` and maps `start` → `dir === 'rtl' ? 'right' : 'left'` and `end` → the opposite. Code never passes `side="left"` or `side="right"` directly.
- **Popovers and menus:** use `align="start"` or `align="end"` and `side="top" | "bottom"`. `side="left" | "right"` is forbidden except through the `useLogicalSide('start' | 'end')` helper, which returns the physical side for the current direction.
- **Toaster:** sonner `position="top-center"` in every language (direction-neutral), `dir` prop set from preferences.
- **Tab order:** DOM order equals logical reading order. RTL mirrors the visual layout automatically; `tabIndex > 0` is forbidden.

#### 7.11.1 shadcn RTL audit (mandatory, per generated component)

Generate with `pnpm dlx shadcn@4.21.0 add <name>` into `src/components/ui/`, then apply exactly these changes and tick the component in `docs/rtl-audit.md` (a checklist committed with the code):

| Component | Required changes |
|---|---|
| `button` | Icon spacing `mr-2`/`ml-2` → `me-2`/`ms-2`; directional icons via `DirIcon`; add `whileTap` press (7.14). |
| `input`, `textarea` | Replace any `text-left` with `text-start`; `file:` utilities `file:mr-*` → `file:me-*`. |
| `label`, `badge`, `card`, `skeleton`, `separator` | Search for physical classes; none are expected; confirm and tick. |
| `select` | Trigger `pl-3 pr-2` → `ps-3 pe-2`; item `pl-2 pr-8` → `ps-2 pe-8`; item indicator `right-2` → `end-2`; content `data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2` → keep (Radix sets physical side) but never request left/right sides; `SelectScrollUpButton`/`Down` unchanged. |
| `checkbox`, `radio-group` | Label spacing `ml-2` → `ms-2`; item layout uses `gap-2`. |
| `switch` | Thumb `data-[state=checked]:translate-x-[calc(100%-2px)]` → add `rtl:data-[state=checked]:-translate-x-[calc(100%-2px)]`; unchecked `translate-x-0` unchanged. |
| `dialog`, `alert-dialog` | Close button `absolute top-4 right-4` → `absolute top-4 end-4`; header `text-center sm:text-left` → `text-center sm:text-start`; footer `sm:justify-end sm:space-x-2` → `sm:justify-end gap-2`. Rebuild open/close animation with `motion` (7.14). |
| `sheet` | Replace the `side` variants `left`/`right` with `start`/`end`: `start` = `inset-y-0 start-0 h-full w-3/4 border-e sm:max-w-sm`, `end` = `inset-y-0 end-0 h-full w-3/4 border-s sm:max-w-sm`; close button `right-4` → `end-4`; slide animation via `motion` with `x` from `dir`-aware offsets (7.14). |
| `dropdown-menu` | `SubTrigger` chevron `ml-auto` → `ms-auto` and wrap with `rtl:-scale-x-100`; `CheckboxItem`/`RadioItem` `pl-8 pr-2` → `ps-8 pe-2`, indicator `left-2` → `start-2`; `Label` `pl-8` → `ps-8` when inset; `Shortcut` `ml-auto` → `ms-auto`. |
| `popover`, `tooltip` | Never pass `side="left" | "right"`; use `useLogicalSide`. |
| `command` | Input icon `mr-2` → `me-2`; `CommandShortcut` `ml-auto` → `ms-auto`. |
| `calendar` | Pass `dir` prop from preferences; nav buttons `left-1`/`right-1` → `start-1`/`end-1`; previous/next chevrons via `DirIcon`; set `weekStartsOn={6}`; custom `formatters` for caption and weekday using i18n names and Western digits. |
| `table` | `TableHead` `text-left` → `text-start`; checkbox column `pr-0` → `pe-0`; numeric columns use `text-end`. |
| `tabs` | `TabsList` `justify-start` confirmed; tab triggers use `gap-*`. |
| `scroll-area` | Vertical scrollbar `border-l` → `border-s`; horizontal unchanged. |
| `breadcrumb` | Separator `ChevronRight` → `DirIcon`; `BreadcrumbEllipsis` unchanged. |
| `pagination` | `PaginationPrevious` `pl-2.5` → `ps-2.5` with `DirIcon ChevronLeft`; `PaginationNext` `pr-2.5` → `pe-2.5` with `DirIcon ChevronRight`. |
| `sonner` | `position="top-center"`, `dir={dir}`, `richColors`, `closeButton`; the close-button position comes from sonner's own `dir` support. |
| `field` | `FieldLabel`/`FieldDescription` `text-left` → `text-start`; horizontal orientation uses `gap-*`. |

#### 7.11.2 RTL verification
The Playwright spec `e2e/rtl.spec.ts` runs the three daily flows (7.4) and the order detail page with preferences `{ language: 'ckb' }` (set by `page.addInitScript` writing `localStorage['pallet.prefs.v1']`) at 1280 × 800 and 390 × 844. It asserts `document.documentElement.dir === 'rtl'`, and saves screenshots with `expect(page).toHaveScreenshot('<flow>-ckb-<width>.png', { maxDiffPixelRatio: 0.01 })`. Baseline screenshots are committed under `apps/web/e2e/__screenshots__/`, and updating them requires a reviewed commit.

### 7.12 Theme and font size

- **Mechanism:** Tailwind 4 CSS-first config in `src/styles/globals.css`:
  ```css
  @import "tailwindcss";
  @import "tw-animate-css";
  @custom-variant dark (&:where(.dark, .dark *));
  ```
  Colors are CSS variables on `:root` (light) and `.dark` (dark), exposed to Tailwind with `@theme inline { --color-background: var(--background); … }`.
- **Tokens (OKLCH).** Every foreground/background pair below meets WCAG AA (≥ 4.5 : 1 for text, ≥ 3 : 1 for large text and UI borders). The builder verifies each pair with the Chrome DevTools contrast checker during M6 and records the ratios in `docs/rtl-audit.md` (section "Contrast").

| Token | Light | Dark |
|---|---|---|
| `--background` | `oklch(0.985 0.002 250)` | `oklch(0.17 0.01 250)` |
| `--foreground` | `oklch(0.2 0.02 250)` | `oklch(0.96 0.005 250)` |
| `--card` / `--popover` | `oklch(1 0 0)` | `oklch(0.21 0.012 250)` |
| `--card-foreground` / `--popover-foreground` | `oklch(0.2 0.02 250)` | `oklch(0.96 0.005 250)` |
| `--primary` | `oklch(0.45 0.13 255)` | `oklch(0.74 0.12 255)` |
| `--primary-foreground` | `oklch(0.99 0 0)` | `oklch(0.18 0.03 255)` |
| `--secondary` | `oklch(0.95 0.01 250)` | `oklch(0.27 0.015 250)` |
| `--secondary-foreground` | `oklch(0.25 0.02 250)` | `oklch(0.94 0.005 250)` |
| `--muted` | `oklch(0.955 0.006 250)` | `oklch(0.26 0.012 250)` |
| `--muted-foreground` | `oklch(0.47 0.02 250)` | `oklch(0.74 0.015 250)` |
| `--accent` | `oklch(0.94 0.02 255)` | `oklch(0.3 0.03 255)` |
| `--accent-foreground` | `oklch(0.25 0.05 255)` | `oklch(0.95 0.01 255)` |
| `--destructive` | `oklch(0.53 0.2 27)` | `oklch(0.68 0.19 25)` |
| `--destructive-foreground` | `oklch(0.99 0 0)` | `oklch(0.17 0.02 25)` |
| `--success` | `oklch(0.5 0.13 150)` | `oklch(0.75 0.14 150)` |
| `--success-foreground` | `oklch(0.99 0 0)` | `oklch(0.17 0.03 150)` |
| `--warning` | `oklch(0.52 0.14 70)` | `oklch(0.8 0.14 80)` |
| `--warning-foreground` | `oklch(0.15 0.03 70)` | `oklch(0.17 0.03 80)` |
| `--info` | `oklch(0.5 0.13 240)` | `oklch(0.76 0.11 240)` |
| `--info-foreground` | `oklch(0.99 0 0)` | `oklch(0.17 0.03 240)` |
| `--border` / `--input` | `oklch(0.87 0.01 250)` | `oklch(0.34 0.015 250)` |
| `--ring` | `oklch(0.45 0.13 255)` | `oklch(0.74 0.12 255)` |
| `--radius` | `0.625rem` | `0.625rem` |

  Status usage: OPEN → info, SETTLED → success, CANCELLED → muted, low stock → warning, over credit limit → destructive. Soft badge variants use `bg-<token>/12 text-<token>` in light and `bg-<token>/20 text-<token>` in dark; these must also pass AA (verified in M6).
- **Font size:** `html { font-size: var(--app-font-size, 16px); }`. Every size, spacing, radius and icon size in the UI is `rem`-based (Tailwind defaults, `size-4`, `text-sm`), so all sizes scale with the preference. `px` units are allowed only for 1 px borders, focus-ring widths and the receipt (which uses `mm`/`pt`). `FONT_SIZE_PX = { sm: 14, md: 16, lg: 18, xl: 20 }`.
- **Colour themes, typefaces, system mode:** see Q50. The values above were the single palette before it; `globals.css` now derives every token from the theme's knobs, and `theme.test.ts` holds each pair to the ratios above.
- **Receipt and print:** the `_print` layout marks `<html data-force-light>` on mount, which keeps the `dark` class off whatever the theme or the device does, and removes the mark on unmount (Q50). `@media print { :root { color-scheme: light; } }` forces light tokens for any printed page (including reports).
- `<meta name="color-scheme" content="light dark">` is in `index.html`. `boot-prefs.js` also sets `document.documentElement.style.colorScheme` to the theme.

### 7.13 Fonts

- Packages: `@fontsource-variable/inter@5.3.0` (Latin, Western digits) and `@fontsource-variable/noto-sans-arabic@5.3.0` (Arabic script with full Kurdish Sorani coverage: ە ێ ۆ ڵ ڕ ڤ گ چ پ ژ). Imported as `wght.css` in `main.tsx`; Vite emits the woff2 files into `dist/assets`, which are served by Caddy from our origin. No CDN.
- Font stack (in `@theme`): `--font-sans: var(--app-font)`, where `--app-font` defaults to `"Inter Variable", "Noto Sans Arabic Variable", ui-sans-serif, system-ui, sans-serif;` and `[data-font]` swaps it for Vazirmatn, IBM Plex Sans Arabic, Noto Kufi Arabic or Noto Naskh Arabic, each followed by Inter (Q50). Inter has no Arabic glyphs, so the browser takes Arabic-script characters from Noto Sans Arabic and Latin letters and digits from Inter. This keeps digits Western and consistent in every language.
- Arabic-script line height: `:root:lang(ckb), :root:lang(ar) { line-height: 1.7; }`; English `1.5`.
- Numeric cells, money and quantities use `font-variant-numeric: tabular-nums` (`tabular-nums`).
- Weights in use: 400, 500, 600, 700 only.

### 7.14 Motion

- **Library:** `motion@13.2.0`, imported from `motion/react`. The whole app is wrapped in `<MotionConfig reducedMotion="user">`.
- **Tokens** (`src/lib/motion.ts`):
  ```ts
  export const DURATION = { fast: 0.15, base: 0.2, slow: 0.3 } as const   // seconds; 150–300 ms only
  export const EASE_OUT = [0.16, 1, 0.3, 1] as const
  export const dirX = (dir: 'ltr' | 'rtl', px: number) => (dir === 'rtl' ? -px : px)
  ```
- **What animates, and how:**

| Element | Animation | Duration |
|---|---|---|
| Route change inside `_app` (`AnimatedOutlet`, keyed by the deepest match's `routeId`) | enter only: `opacity 0 → 1`, `x dirX(dir, 8) → 0`; no exit animation, so the new page is never delayed | base |
| DataTable rows and list cards | `AnimatePresence initial={false}`; enter `opacity 0 → 1, y 4 → 0`; exit `opacity 1 → 0`; only when the list has ≤ 50 rows; no `layout` animations | fast |
| Dialog / AlertDialog | Radix `Portal forceMount` inside `AnimatePresence` driven by `open`; overlay `opacity 0 → 1`; content `opacity 0 → 1, scale 0.98 → 1`; exit reverse | base (exit fast) |
| Sheet | `x` from `±100%` on the side it opens from (`start`/`end` resolved by `dir`), overlay fade | base (exit fast) |
| Dropdown, popover, select, tooltip, command | shadcn's `tw-animate-css` classes (`data-[state=open]:animate-in fade-in-0 zoom-in-95`) with `duration-150` | fast |
| Dashboard `CountUp` | `animate(from, to, { duration: 0.3, ease: EASE_OUT, onUpdate })`; first render counts from 0; later changes count from the previous value | slow |
| Buttons | `motion.button` with `whileTap={{ scale: 0.98 }}` (when `asChild`, CSS `active:scale-[0.98] transition-transform duration-150`); hover is a color transition `transition-colors duration-150` | fast |
| Toasts | sonner's built-in animation | library default |
| Summary panel numbers in the daily flows | no animation (values must be instantly readable while typing) | — |

- **Reduced motion:** `MotionConfig reducedMotion="user"` disables transform animations. `useCountUp` sets the final value immediately when `useReducedMotion()` is true. Global CSS: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }`.
- **Never:** motion on skeleton-to-content swaps, delayed navigation, animations over 300 ms, parallax, auto-playing loops (except the skeleton pulse, which is disabled under reduced motion).

### 7.15 Keyboard, accessibility and responsive rules

Keyboard:
- Enter submits the focused form. Esc closes dialogs, sheets, popovers and comboboxes (Radix). Dialog focus is trapped (Radix) and returns to the trigger on close. The destructive `ConfirmDialog` focuses "Cancel" first; other dialogs focus the first field.
- Comboboxes: typing filters, ArrowUp/ArrowDown move, Enter selects, Home/End jump.
- `DataTable`: the first cell's link is the tab stop per row; Enter opens the row.
- No positive `tabIndex`. The skip link is the first tab stop.

Accessibility:
- Every input has a visible `<label>`. Icon-only buttons have `aria-label` (translated).
- Focus ring on every interactive element: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`. Removing the ring without this replacement is forbidden.
- Color is never the only carrier of information: status badges, low-stock flags, reversal/reversed markers, signed stock quantities and changed rows in `AuditDiff` always have an icon or text as well.
- Tables use `<th scope="col">`; sortable headers carry `aria-sort`.
- Toasts (sonner) announce through `aria-live="polite"`; destructive errors use `role="alert"` inline.
- `<html lang>` always matches the UI language; the receipt root has `lang="ckb"`.
- Contrast: tokens in 7.12.
- Target sizes: interactive elements are at least `h-9` (2.25 rem) on `≥ md` and `h-10` below `md`.

Responsive:
- Desktop-first. Breakpoints are Tailwind defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280 px).
- Every screen must be usable at **390 px** width with no horizontal page scroll. Tables become cards below `md`; forms are single-column below `md`; the daily flows use the bottom summary bar below `lg`; the sidebar becomes a `Sheet` below `lg`; dialogs are full-width with `max-h-[90dvh]` scrolling below `sm`.
- The Playwright spec `e2e/responsive.spec.ts` visits every route in the routing table (with seeded data) at 390 × 844 and asserts `document.documentElement.scrollWidth <= 390`.
- Printing happens from desktop; print styles target A4.

### 7.16 Receipt print route (`/print/orders/$orderId`)

#### 7.16.1 Behaviour
- **Layout** `_print.tsx`: authenticated (`requireAuthenticated`), no AppShell; removes `dark` from `<html>` while mounted; renders a screen-only toolbar (`print:hidden`) with the buttons "Print" (`window.print()`) and "Close" (`window.close()`), labelled in the **UI** language.
- **Data:** `GET /api/orders/:id/receipt` (key `['orders','receipt',id]`). Response `ReceiptDto` exactly as defined in §6.9 (the server does the chunking): `orderNumber`, `orderNumberDisplay` (zero-padded), `date`, `paymentType`, `depositTotal`, `factory { name, phone, address, logoUrl | null }`, `customer { name, phone, altPhone, address }` (the receipt prints name, phone, address only), `driver { name, phone, carNumber }`, `linesPerHalf`, `sheets [{ sheetNumber, sheetCount, lines [{ itemName, quantity, unitDeposit, lineTotal }], showTotal }]` (lines ordered by order line id).
- `409 ORDER_CANCELLED` → an error page `receipt.cancelledError` with a Close button. The API refuses cancelled orders (Q10).
- **Auto-print:** after data is loaded, `await document.fonts.ready`, and the logo `<img>` has fired `load` or `error` (or there is no logo), call `window.print()` once (guarded by a ref). Reprinting is always possible with the toolbar button or the order page.
- **Language:** the receipt is **always Kurdish Sorani** regardless of the UI language: root element `<div class="receipt" dir="rtl" lang="ckb">`, and all labels from `const tr = i18n.getFixedT('ckb')` with keys `receipt.*`.
- **Formatting:** Western digits; money `formatMoney(n)` + ` ` + `tr('receipt.currency')`; date `dd/MM/yyyy` (`formatBusinessDate`); receipt number `formatOrderNumber(orderNumber)` (zero-padded to 6 digits).

#### 7.16.2 Chunking (A15)
The API has already chunked the lines (`sheets = chunkReceiptLines(lines, RECEIPT_LINES_PER_HALF)`, §6); the route renders `sheets` as given and never re-chunks.
```
Y      = sheets.length (= sheets[k].sheetCount)
sheet k (1-based, sheets[k−1]) renders its lines twice: half 1 (top) and half 2 (bottom), identical
line number column "#" = (k − 1) × linesPerHalf + index within the sheet + 1 (continues across sheets)
depositTotal row only where showTotal = true (sheet Y); other sheets show receipt.continued instead
"sheet k of Y" on every half
```
Example: an order with 14 lines → chunks of 6, 6, 2 → 3 A4 sheets; sheet 3 shows lines 13–14, four empty rows, and the deposit total; each sheet prints the header and "پەڕەی k لە 3".

#### 7.16.3 Exact layout (`src/features/receipt/receipt.css`, imported only by the receipt route)
```css
@page { size: A4 portrait; margin: 0; }
@media print {
  html, body { margin: 0; background: #fff; }
  .receipt-toolbar { display: none; }
}
.receipt { font-family: "Noto Sans Arabic Variable", "Inter Variable", sans-serif;
           font-size: 10pt; line-height: 1.35; color: #000;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.receipt .num { font-family: "Inter Variable", sans-serif; direction: ltr; unicode-bidi: isolate;
                font-variant-numeric: tabular-nums; }
.sheet  { width: 210mm; height: 297mm; box-sizing: border-box; overflow: hidden;
          break-after: page; page-break-after: always; background: #fff; }
.sheet:last-child { break-after: auto; page-break-after: auto; }
.half   { height: 148.5mm; box-sizing: border-box; padding: 8mm 10mm;
          display: flex; flex-direction: column; gap: 4mm; overflow: hidden; }
.half + .half { border-top: 0.3mm dashed #000; }            /* the cut line, exactly at 148.5 mm */
.cut-mark { position: absolute; inset-inline-start: 4mm; margin-top: -2.5mm; width: 5mm; height: 5mm; }
.block-header  { height: 22mm; }
.block-parties { height: 24mm; }
.block-lines   { height: 49mm; }   /* 1 header row + 6 body rows, 7mm each */
.block-footer  { height: 20mm; }
.lines { width: 100%; border-collapse: collapse; table-layout: fixed; }
.lines th, .lines td { height: 7mm; padding: 0 1.5mm; border: 0.2mm solid #000; vertical-align: middle; }
.lines th { font-size: 8.5pt; font-weight: 600; background: #f0f0f0; }
.col-no { width: 8mm; } .col-qty { width: 20mm; } .col-unit { width: 30mm; } .col-total { width: 34mm; }
/* .col-item takes the remaining width; item names are clipped with text-overflow: ellipsis; white-space: nowrap */
@media screen { body { background: #e5e5e5; } .sheet { margin: 8mm auto; box-shadow: 0 1mm 4mm rgb(0 0 0 / 0.25); } }
```
Height budget per half: content area 148.5 − 2 × 8 = 132.5 mm; blocks 22 + 24 + 49 + 20 = 115 mm; three gaps × 4 mm = 12 mm; total 127 mm ≤ 132.5 mm (5.5 mm spare). The CSS forbids overflow, so the font size is fixed at 10 pt (the UI font-size preference does not apply). The cut line is the dashed top border of the second half. A lucide `Scissors` icon (5 mm, `.cut-mark`) sits on the line at the inline-start edge of the second half (position the half `relative`).

Block contents, in reading order (RTL: "start" = right side of the page):

1. **Header** (`.block-header`, flex row, `justify-content: space-between`):
   - start side: logo (`max-height: 18mm; max-width: 30mm; object-fit: contain`; omitted when `logoUrl` is null), then `factory.name` (13 pt, 700) and below it factory `phone` and `address` (8.5 pt) with labels `receipt.factoryPhone`, `receipt.factoryAddress`.
   - end side: title `receipt.title` (12 pt, 700); `receipt.receiptNumber`: `<span class="num">000123</span>`; `receipt.date`: `<span class="num">11/09/2026</span>`.
2. **Parties** (`.block-parties`, two equal columns separated by 4 mm, each boxed with a 0.2 mm border and 2 mm padding):
   - Customer column: heading `receipt.customer` (9 pt, 600); rows `receipt.name`: name; `receipt.phone`: `<bdi class="num">phone</bdi>`; `receipt.address`: address (clamped to 1 line with ellipsis).
   - Driver column: heading `receipt.driver`; rows `receipt.name`, `receipt.phone`, `receipt.carNumber` (`<bdi class="num">`).
3. **Lines** (`.block-lines`): table with header row `#` | `receipt.item` | `receipt.quantity` | `receipt.unitDeposit` | `receipt.lineTotal`, then exactly 6 body rows (empty rows render empty cells so the grid is stable). Numeric cells are `.num`, aligned `text-align: end`.
4. **Footer** (`.block-footer`, three rows):
   - row 1: on sheet Y → `receipt.depositTotal`: `<span class="num">125,000</span> دینار` (11 pt, 700); on other sheets → `receipt.continued` (9 pt, italic).
   - row 2: `receipt.paymentType`: `receipt.paymentCash` or `receipt.paymentLent` (10 pt, 600).
   - row 3 (end-aligned, 8.5 pt): `receipt.sheetOf` with `{{x}}`, `{{y}}` as `.num`.

No notes, no signature lines (A9).

#### 7.16.4 Sorani receipt strings (`receipt.*` in `ckb.json`)

The `en.json` and `ar.json` files carry translated counterparts of the same keys to satisfy the completeness test; only `ckb` is ever rendered on the receipt. **These strings must be proofread by a native Sorani speaker at the client before go-live (Q22).**

| Key | Sorani (ckb) | English gloss |
|---|---|---|
| `receipt.pageTitle` | `پسووڵەی ڕادەستکردن` | Hand-over receipt (browser tab title) |
| `receipt.title` | `پسووڵەی ڕادەستکردنی پالێت` | Pallet hand-over receipt |
| `receipt.receiptNumber` | `ژمارەی پسووڵە` | Receipt no. |
| `receipt.date` | `بەروار` | Date |
| `receipt.factoryPhone` | `تەلەفۆن` | Phone |
| `receipt.factoryAddress` | `ناونیشان` | Address |
| `receipt.customer` | `کڕیار` | Customer |
| `receipt.driver` | `شۆفێر` | Driver |
| `receipt.name` | `ناو` | Name |
| `receipt.phone` | `ژمارەی تەلەفۆن` | Phone number |
| `receipt.address` | `ناونیشان` | Address |
| `receipt.carNumber` | `ژمارەی ئۆتۆمبێل` | Car number |
| `receipt.item` | `جۆری پالێت` | Pallet type |
| `receipt.quantity` | `بڕ` | Quantity |
| `receipt.unitDeposit` | `تەئمیناتی دانە` | Deposit per pallet |
| `receipt.lineTotal` | `کۆ` | Line total |
| `receipt.depositTotal` | `کۆی گشتی تەئمینات` | Total deposit |
| `receipt.paymentType` | `جۆری پارەدان` | Payment type |
| `receipt.paymentCash` | `پارە دراوە (نەقد)` | Paid cash |
| `receipt.paymentLent` | `بە قەرز` | Lent (not paid) |
| `receipt.currency` | `دینار` | IQD |
| `receipt.continued` | `بەردەوامە لە پەڕەی داهاتوو` | Continued on the next sheet |
| `receipt.sheetOf` | `پەڕەی {{x}} لە {{y}}` | Sheet x of y |
| `receipt.cancelledError` | `ئەم داواکارییە هەڵوەشێنراوەتەوە و پسووڵەی بۆ چاپ ناکرێت` | This order is cancelled; its receipt cannot be printed |

#### 7.16.5 Receipt tests
- Unit (`src/features/receipt/receipt.test.tsx`, jsdom): 1 line → 1 sheet, 2 halves, total present; 6 lines → 1 sheet; 7 lines → 2 sheets, lines 1–6 then 7, total only on sheet 2, text `پەڕەی 2 لە 2`; 14 lines → 3 sheets; both halves of a sheet have identical text content; labels are Sorani while `i18n.language === 'en'`.
- E2E (`e2e/receipt.spec.ts`, Chromium): open the print route for a seeded 7-line order, wait for the `.sheet` elements, `page.emulateMedia({ media: 'print' })`, generate `page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })`, and assert the PDF has exactly 2 pages (count `/Type /Page` objects). The screenshot `receipt-7-lines.png` is compared against the committed baseline.

## 8. Shared package contents

`packages/shared` (`@pallet/shared`) is the single source of truth for everything both apps must agree on. It is ESM (`"type": "module"`), built with `tsc -b` into `dist/` (JavaScript + `.d.ts`), and consumed by the API (CommonJS, through Node 24 `require(esm)`) and by the web app (Vite). Its runtime dependencies are `zod@4.6.2`, `date-fns@4.4.0` and `@date-fns/tz@1.5.0` (used by `dates.ts`).

**Baseline vs. to-be-built.** The baseline repository already contains `enums.ts`, `permissions.ts`, `error-codes.ts`, `dates.ts`, `domain/ledger-math.ts`, `schemas/common.ts` (`Id`, `Version`, `Money`, `PositiveMoney`, `Quantity`, `BusinessDate`, `PageQuery`, `PageDto`) and the tests `ledger-math.test.ts` and `permissions.test.ts`. Every other file and export listed in this section (`format.ts`, `constants.ts`, `i18n-keys.ts`, `schemas/zod-issues.ts`, `schemas/dto.ts`, the remaining `schemas/*.ts`, `CLIENT_ERROR_CODES`, `ACTIVITY_EVENT_KINDS`, `CUSTOMER_HISTORY_KINDS`, the extra `dates.ts` helpers and the remaining tests) is added by the builder in the milestone that first needs it (section 15); existing exports keep their names. It never imports Node-only or browser-only APIs, except `crypto.randomUUID`/`Intl`, which exist in both. Relative imports inside the package use the `.js` extension (NodeNext resolution).

`package.json` `exports`:
```json
{ ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
```
All public symbols are re-exported from `src/index.ts`; deep imports are forbidden.

### 8.1 `src/enums.ts`
Exports value arrays, value objects and types (identical to the Prisma enums; the test `enums.test.ts` parses `apps/api/prisma/schema.prisma` and asserts equality):
`ROLES`/`Role`, `PAYMENT_TYPES`/`PaymentType`, `ORDER_STATUSES`/`OrderStatus`, `STOCK_MOVEMENT_REASONS`/`StockMovementReason`, `LEDGER_ENTRY_TYPES`/`LedgerEntryType`, `LEDGER_ENTRY_SOURCES`/`LedgerEntrySource`, `RETURN_REVERSAL_KINDS`/`ReturnReversalKind`, `UPLOAD_KINDS`/`UploadKind`, `AUDIT_ACTIONS`/`AuditAction`, `AUDIT_ENTITY_TYPES`/`AuditEntityType`, plus the browser preference enums `LANGUAGES`/`Language`, `RTL_LANGUAGES`, `THEMES`/`Theme`/`ResolvedTheme`, `PALETTES`/`Palette`, `FONT_FAMILIES`/`FontFamily`, `FONT_SIZES`/`FontSize`, `FONT_SIZE_PX`. The package also defines (in this file) `ACTIVITY_EVENT_KINDS = ['HANDOVER', 'CANCELLATION', 'RETURN', 'PAYMENT', 'REFUND'] as const` / `ActivityEventKind` (the dashboard `ActivityEventDto.kind` of §6.9; reversals are flagged by `ActivityEventDto.reversed`, not by a separate kind) and `CUSTOMER_HISTORY_KINDS = ['HANDOVER', 'RETURN', 'LEDGER'] as const` / `CustomerHistoryKind` (the `CustomerHistoryItemDto.kind` of §6.9 and the `kinds` filter of `CustomerHistoryQuery`).

### 8.2 `src/permissions.ts`
`GRANTABLE_PERMISSION_KEYS` (33 keys), `ADMIN_ONLY_PERMISSION_KEYS` (3 keys), `PERMISSION_KEYS`, types `GrantablePermissionKey`, `AdminOnlyPermissionKey`, `PermissionKey`, `PERMISSION_DEPENDENCIES`, `isGrantablePermissionKey()`, `isAdminOnlyPermissionKey()`, `closePermissionSet()`, `missingPermissionDependencies()`. It also exports `PERMISSION_MODULES` — an ordered list of `{ module: 'items' | 'purchases' | 'customers' | 'drivers' | 'orders' | 'returns' | 'payments' | 'reports' | 'audit', keys: GrantablePermissionKey[] }` used by `PermissionMatrix` — and `dependentsOf(key)` (the reverse closure used when unticking).

### 8.3 `src/error-codes.ts`
`ERROR_CODES` (code → HTTP status), `ErrorCode`, `ERROR_CODE_LIST`, `ApiErrorBody`, `ApiFieldError`, `VALIDATION_CODES`, `ValidationCode`. It also exports `CLIENT_ERROR_CODES = ['NETWORK_ERROR', 'UNKNOWN_ERROR'] as const` (web-only codes, never sent by the API) and the type `AnyErrorCode = ErrorCode | (typeof CLIENT_ERROR_CODES)[number]`.

### 8.4 `src/domain/ledger-math.ts`
`RECEIPT_LINES_PER_HALF` (6), `MONEY_INPUT_MAX` (1,000,000,000,000), `QUANTITY_INPUT_MAX` (1,000,000); types `OrderLineState`, `ReturnLineState`, `ReturnState`, `LedgerEntryState`, `OrderState`, `LineTotals`, `OrderTotals`, `CreditCheckInput`, `CreditCheckResult`; class `LedgerInvariantError`; functions `returnRefundDue()`, `returnMoney()`, `computeOrderTotals()`, `checkCreditLimit()`, `chunkReceiptLines()`. The test `ledger-math.test.ts` encodes every worked example of section 4.

### 8.5 `src/schemas/` (zod 4 schemas for every request body and query string)
**Naming rule (binding, identical to §6.27):** request bodies `<Entity><Action>Body` (`OrderCreateBody`, `ReturnReplaceBody`), query strings `<Entity>ListQuery` or `<Name>Query` (`CustomerPhoneCheckQuery`), shared primitive schemas PascalCase (`Money`, `BusinessDate`, `Phone`), schema factories camelCase (`sortParam(fields)`, `dateRange()`, `optionalText(max)`). For each schema `X` the package exports `type X = z.infer<typeof X>` and `type XInput = z.input<typeof X>` (form values). Every object schema is `z.strictObject(...)` (unknown keys rejected). Field lists and limits are exactly those of section 6; the API validates with these schemas through `ZodValidationPipe` and the web app passes the same schemas to `zodResolver`.

**Response DTOs** are TypeScript interfaces (types only, no runtime schema) in `src/schemas/dto.ts`, exactly the interfaces of §6.9 (`ItemDto`, `OrderDetailDto`, `ReceiptDto`, `PageDto<T>`, and the rest listed there).

**Export list:** the file-by-file table in §6.27 is the single list; it is not repeated here. Details that table does not show:

| File | Additional contract |
|---|---|
| `common.ts` | `Money` int 0..`MONEY_INPUT_MAX`; `PositiveMoney` int 1..`MONEY_INPUT_MAX`; `Quantity` int 1..`QUANTITY_INPUT_MAX`; `NonNegQuantity` int 0..`QUANTITY_INPUT_MAX`; `BusinessDate` = valid `YYYY-MM-DD` ≥ `2000-01-01` (the "not after today in Asia/Baghdad" rule is checked by the API and raises `BUSINESS_DATE_IN_FUTURE`); `Phone` = `normalizePhone` (Western digits, then strip spaces, dashes, parentheses), then `^\+?[0-9]{7,15}$` (Q13); `optionalText(max)` trims and maps `''` to `null`; `PageQuery` = `page` (default 1) + `pageSize` (1..100, default 25); `dateRange()` refines `dateFrom ≤ dateTo` → `DATE_RANGE_INVALID`. |
| `zod-issues.ts` | `mapZodIssue(issue): ApiFieldError`: `invalid_type` with input `undefined` → `required`; `invalid_type` expecting an integer → `not_integer`; other `invalid_type` → `invalid_type`; `too_small` on strings → `too_short` (params `min`); `too_small` on numbers/arrays → `too_small` (params `min`); `too_big` on strings → `too_long` (params `max`); `too_big` on numbers/arrays → `too_big` (params `max`); `invalid_format` → `invalid_format`; `invalid_value` → `invalid_enum`; `unrecognized_keys` → `unknown_key` (one field error per key); `custom` issues carry `params.code` (`invalid_date`, `duplicate`) and map to it. Path segments joined with `.`. |
| `uploads.ts` | Besides `UploadCreateQuery`: constants `UPLOAD_MAX_BYTES = 5_242_880`, `UPLOAD_ACCEPT = ['image/png','image/jpeg','image/webp']`, `UPLOAD_FILE_NAME_PATTERN = /^[0-9a-f]{32}\.webp$/`. |
| `orders.ts` | `OrderCreateBody` refines unique `itemId` across `lines` (custom issue `duplicate` on `lines.<i>.itemId`). |
| `returns.ts` | `ReturnCreateBody` refines: at least one line with `acceptedQuantity + damagedQuantity > 0` (API raises `RETURN_EMPTY`), unique `orderLineId` (`duplicate`); `ReturnReplaceBody` is the same schema. |
| `dto.ts` | Types only; imported with `import type`. |

### 8.6 `src/dates.ts`
`BUSINESS_TIME_ZONE = 'Asia/Baghdad'`, `MIN_BUSINESS_DATE = '2000-01-01'`, `businessToday(now?: Date): string` (the Asia/Baghdad calendar day via `@date-fns/tz` `TZDate` and `format(…, 'yyyy-MM-dd')`), `isBusinessDate(s): boolean` (a real calendar day in `YYYY-MM-DD` form), `businessDateToDb(s): Date` (`new Date(s + 'T00:00:00.000Z')`), `dbDateToBusiness(d: Date): string` (`d.toISOString().slice(0, 10)`), `formatBusinessDate(s): string` (`YYYY-MM-DD` → `dd/MM/yyyy`), `formatTimestamp(value: string | Date): string` (`dd/MM/yyyy HH:mm` in Asia/Baghdad) — these exist in the baseline. Added by the builder: `businessDayStartUtc(s): Date` and `businessDayRangeToUtc(from?, to?)` (a Baghdad day filter as the half-open UTC interval `[from 00:00, to+1 00:00)`, §11.6), `compareBusinessDates(a, b): -1 | 0 | 1` and `firstDayOfMonth(s): string`. `@date-fns/tz@1.5.0` and `date-fns@4.4.0` are runtime dependencies of the shared package.

### 8.7 `src/format.ts`
`formatNumber(n): string` (`Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })` — Western digits, comma thousands), `formatMoney(n): string` (same, without currency), `formatOrderNumber(n): string` (`String(n).padStart(6, '0')`), `toWesternDigits(s): string` (maps `٠-٩` and `۰-۹` to `0-9`), `normalizePhone(s): string` (Western digits, then strips spaces, `-`, `(`, `)`), `canonicalJson(value): string` (keys sorted recursively; used for idempotency request hashes on the API and key reuse on the web).

### 8.8 `src/constants.ts`
`CSRF_HEADER_NAME = 'X-Requested-With'`, `CSRF_HEADER_VALUE = 'pallet-web'`, `IDEMPOTENCY_HEADER_NAME = 'Idempotency-Key'`, `IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed'`, `REFRESH_COOKIE_NAME = 'pallet_rt'`, `REFRESH_COOKIE_PATH = '/api/auth'`, `ACCESS_TOKEN_TTL_SECONDS = 900`, `REFRESH_TOKEN_SLIDING_DAYS = 14`, `REFRESH_TOKEN_ABSOLUTE_DAYS = 30`, `REFRESH_GRACE_SECONDS = 30`, `IDEMPOTENCY_TTL_HOURS = 24`, `PAGE_SIZE_DEFAULT = 25`, `PAGE_SIZE_MAX = 100`, `PASSWORD_MIN_LENGTH = 10`, `PASSWORD_MAX_LENGTH = 128`, `USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/`, `PHONE_PATTERN = /^\+?[0-9]{7,15}$/`, `ORDER_NUMBER_PAD = 6`, `PREFS_STORAGE_KEY = 'pallet.prefs.v1'`, `DEFAULT_PREFERENCES = { language: 'ckb', theme: 'light', palette: 'harbor', font: 'inter', fontSize: 'md' }`.

### 8.9 i18n key types (Q49)
Translation keys are typed in the web app, where they are used: `apps/web/src/i18n/keys.ts` exports `TranslationKey` (i18next's `ParseKeys`, checked against `en.json`) and `dynamicKey(key)` for keys assembled from data (`errors.${code}`, `enums.${name}.${value}`, `permissions.${key}`, `audit.summary.${entity}.${action}`). Which of those keys must exist is computed from the shared constants by `apps/web/src/i18n/locales.test.ts` (§7.10), so the package exports no key builders.

### 8.10 Tests inside the package (vitest, `src/**/*.test.ts`)
`ledger-math.test.ts` (all worked examples from section 4, credit-limit cases, chunking), `permissions.test.ts` (dependency closure, every dependency target is grantable, no cycles, admin-only keys never grantable), `enums.test.ts` (Prisma enum parity), `dates.test.ts` (Baghdad day boundaries: 2026-09-10T21:00:00Z is `2026-09-11` in Baghdad; 20:59:59Z is still `2026-09-10`), `format.test.ts`, `zod-issues.test.ts`.

## 9. Folder structure

Paths are relative to the repository root. Every folder and file listed here exists after milestone 7; folders marked (M1-scaffold) are present already in the scaffold.

### 9.1 Root
```
.
├── .dockerignore                 # build context = repository root: node_modules, dist, .env*, generated code, docs
├── .editorconfig                 # UTF-8, LF, 2-space indent, final newline
├── .env.example                  # every environment variable with description and example (section 13)
├── .gitignore                    # node_modules, dist, .env, apps/api/src/generated, coverage, test-results, playwright-report
├── .husky/pre-commit             # runs `pnpm exec lint-staged` and `pnpm typecheck`
├── .npmrc                        # save-exact=true, engine-strict=true
├── .nvmrc                        # 24.21.0
├── .prettierrc.json              # singleQuote, printWidth 110, trailingComma all
├── .prettierignore               # generated files, lockfile, dist, locales are formatted
├── ARCHITECTURE.md               # this document
├── README.md                     # quick start, commands, links to docs/
├── docker-compose.yml            # production stack: caddy, api, migrate, postgres (section 13)
├── docker-compose.dev.yml        # local Postgres only, bound to 127.0.0.1:5434 (Q33)
├── eslint.config.mjs             # flat config: @eslint/js, typescript-eslint strict-type-checked, react-hooks, react-refresh, prettier
├── package.json                  # root scripts (dev, build, lint, typecheck, test, db:*) and shared dev tooling
├── pnpm-lock.yaml                # committed lockfile (CI uses --frozen-lockfile)
├── pnpm-workspace.yaml           # workspace packages and onlyBuiltDependencies allow-list
└── tsconfig.base.json            # strict compiler options inherited by every package
```

### 9.2 `.github/`
```
.github/
├── dependabot.yml                # weekly updates: npm (root), docker (apps/api, deploy/caddy), github-actions
└── workflows/
    ├── ci.yml                    # lint, format, typecheck, unit, integration (postgres service), audit, build, e2e
    └── deploy.yml                # tag v* / manual: build + push GHCR images, SSH deploy with health-check rollback
```

### 9.3 `packages/shared/`
```
packages/shared/
├── package.json                  # @pallet/shared, ESM, exports ./dist, deps: zod, date-fns, @date-fns/tz
├── tsconfig.json                 # composite, NodeNext, outDir dist, declaration
└── src/
    ├── index.ts                  # re-exports every public symbol
    ├── enums.ts                  # enum arrays, value objects and types (8.1)
    ├── permissions.ts            # permission keys, dependencies, closure helpers (8.2)
    ├── error-codes.ts            # error codes, HTTP statuses, error body types (8.3)
    ├── constants.ts              # header names, TTLs, limits, patterns (8.8)
    ├── dates.ts                  # Asia/Baghdad business-date helpers (8.6)
    ├── format.ts                 # number/money/order-number/phone/canonical-JSON helpers (8.7)
    ├── audit-matrix.ts           # §11.3 as data: the (entity, action) pairs the API may record
    ├── domain/
    │   ├── ledger-math.ts        # section 4 formulas as pure functions (8.4)
    │   └── ledger-math.test.ts   # worked examples
    └── schemas/                  # zod request/response schemas per module (8.5)
        ├── common.ts
        ├── zod-issues.ts
        ├── auth.ts
        ├── users.ts
        ├── settings.ts
        ├── uploads.ts
        ├── items.ts
        ├── purchases.ts
        ├── customers.ts
        ├── drivers.ts
        ├── orders.ts
        ├── returns.ts
        ├── payments.ts
        ├── reports.ts
        ├── audit.ts
        └── dto.ts                # response DTO types shared with the web app
```

### 9.4 `apps/api/`
```
apps/api/
├── Dockerfile                    # multi-stage: deps → build (tsc, prisma generate) → runtime node:24.21.0-bookworm-slim, USER node
├── package.json                  # @pallet/api, CommonJS; scripts dev (tsc-watch), build, copy-assets, start, test, test:integration, db:*, reconcile
├── prisma.config.ts              # Prisma 7 config: schema path, migrations path, datasource url = DATABASE_MIGRATE_URL
├── tsconfig.json                 # module nodenext (CommonJS output), experimentalDecorators, emitDecoratorMetadata
├── tsconfig.build.json           # excludes test/ and *.test.ts; outDir dist
├── vitest.config.mts             # unit tests (src/**/*.test.ts), unplugin-swc for decorator metadata
├── vitest.integration.config.mts # integration tests (test/integration/**), single fork, real Postgres
├── prisma/
│   ├── schema.prisma             # database schema (section 5)
│   ├── migrations/               # Prisma migrations; each contains migration.sql (+ appended raw SQL for checks/triggers)
│   ├── sql/
│   │   ├── constraints.sql       # CHECK constraints, partial indexes and triggers (source appended into migrations)
│   │   └── grants.sql            # idempotent privilege script for pallet_app, run after every migrate deploy
├── src/
│   ├── main.ts                   # bootstrap: pino logger, configureApp, shutdown hooks; exits 1 with the message on a startup failure
│   ├── bootstrap.ts              # configureApp(app, env): trust proxy, JSON body parser (100 KiB, no urlencoded), cookie-parser, global prefix /api — shared with the test harness
│   ├── app.module.ts             # imports every module, registers global guards in the fixed order (section 6)
│   ├── generated/prisma/         # Prisma client output (git-ignored, produced by `prisma generate`)
│   ├── config/
│   │   └── env.ts                # zod schema for process.env, parsed once at startup; exits on invalid config
│   ├── prisma/
│   │   ├── prisma.module.ts      # global module exporting PrismaService
│   │   ├── prisma.service.ts     # PrismaClient with PrismaPg adapter; runInTransaction(fn) helper with isolation/timeouts
│   │   └── locks.ts              # lockUser, lockActiveAdmins, lockCustomer, lockOrder, lockItems (sorted), lockOrderCounter, lockSessionFamily ($queryRaw FOR UPDATE)
│   ├── common/
│   │   ├── clock.ts              # Clock (abstract), SystemClock, FixedClock (tests)
│   │   ├── clock.module.ts       # global module binding Clock → SystemClock
│   │   ├── auth-context.ts       # AuthContext: the caller as rebuilt from the database each request
│   │   ├── decorators/           # @Public, @Authenticated, @RequirePermission, @RequireAnyPermission, @AdminOnly, @CurrentUser, @ThrottleScope
│   │   ├── guards/               # app-throttler.guard, csrf.guard, auth.guard, password-change.guard, permission.guard
│   │   ├── checks/               # permission-declaration.check (fails startup if a route lacks a declaration)
│   │   ├── filters/              # api-exception.filter: maps ApiError/ZodError/Prisma/Throttler/Multer errors to ApiErrorBody
│   │   ├── pipes/                # zod-validation.pipe (body/query/params with shared schemas)
│   │   ├── errors/               # ApiError class + helpers; prisma-errors.ts (unique-violation detection across driver shapes)
│   │   ├── http/                 # request-path.ts: the route path of a request, trailing slash normalised
│   │   ├── context/              # request-context.ts (AsyncLocalStorage: requestId, ip, userId) + the middleware that opens the scope
│   │   └── utils/                # money (toSafeMoney, bigint↔number), dates (Baghdad today), canonical hash, pagination helpers
│   ├── modules/
│   │   ├── health/               # GET /api/health
│   │   ├── auth/                 # login, refresh (rotation + grace), logout, logout-all, me, change-password; auth.constants.ts, auth.mapper.ts, password.service (argon2), password-policy.ts, password.constants.ts (ARGON2_OPTIONS), login-throttle.service, session.service, common-passwords.txt
│   │   ├── users/                # admin user management, permissions, reset password, guards (self/last admin)
│   │   ├── settings/             # factory settings (single row)
│   │   ├── uploads/              # upload-intake.interceptor.ts (multer, Q35 refusals), image-processor.ts (signature + sharp), upload-throttle.guard.ts (per-user limit), uploads.service.ts (+ assertKind for settings and items), uploads.controller.ts (POST, and GET /api/uploads/:fileName)
│   │   ├── stock/                # StockLedger.apply(tx, movements, userId) (§4.6) — the only writer of quantity_on_hand
│   │   ├── items/                # items CRUD/archive, stock adjustments, stock movement listing
│   │   ├── purchases/            # purchase batches CRUD (soft delete), cost-field stripping
│   │   ├── customers/            # customers CRUD/archive, phone check, profile summary, holdings, history timeline
│   │   ├── drivers/              # drivers CRUD/archive
│   │   ├── orders/               # create/edit/cancel, credit check, order number allocation, recompute-order.service, receipt DTO
│   │   ├── returns/              # create/replace/delete returns, refund computation
│   │   ├── ledger/               # manual payments, payment reversal, ledger listing
│   │   ├── idempotency/          # IdempotencyService (lookup, replay, store inside the transaction), hourly purge
│   │   ├── dashboard/            # GET /api/dashboard (permission-gated sections)
│   │   ├── reports/              # positions, purchases, activity, stock report queries (raw SQL aggregates)
│   │   ├── audit/                # audit.service.ts (record(tx, entry)), audit-snapshot.ts (per-entity allow-lists), audit-redaction.ts, audit-query.service.ts + audit.controller.ts + audit.mapper.ts (GET /api/audit-logs)
│   │   └── maintenance/          # hourly/daily cleanup jobs on plain unref'd timers, each also run once at startup so a restart never resets the countdown (login throttles, expired session families; idempotency keys from M3) — one API instance, so no scheduler library
│   └── scripts/
│       ├── migrate.ts            # prisma migrate deploy → grants.sql → first-run seed (idempotent); `--seed-only` for `pnpm db:seed`
│       ├── seed-demo.ts          # dev-only realistic demo data through the domain services (`pnpm db:seed:demo`)
│       ├── healthcheck.ts        # Docker HEALTHCHECK: GET http://127.0.0.1:3000/api/health, exit 0/1
│       └── reconcile.ts          # recompute every order and every item stock from the ledgers; print differences; exit 1 on mismatch
└── test/
    ├── global-setup.ts           # once per run: migrate deploy + grants.sql against pallet_test
    ├── helpers/
    │   ├── app.ts                # boots the Nest app against the test database (app role) for supertest
    │   ├── db.ts                 # truncate/reset helpers run as the owner role; guards that every table is truncated
    │   ├── factories.ts          # createUser / createEmployee(permissions[]) straight to the database; createItem / createCustomer / createOrder via the API
    │   └── auth.ts               # login helpers returning access tokens and cookies
    └── integration/              # *.test.ts: auth, sessions, lockout, users, permissions, uploads, items, purchases, customers, drivers, orders, credit-limit, returns, payments, idempotency, reports, dashboard, audit, cost-stripping, db-privileges, reconciliation
```
Each folder under `src/modules/<module>/` contains `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts`, `<module>.mappers.ts` (row → DTO), and, where queries are non-trivial, `<module>.queries.ts` (raw SQL tagged templates). Unit tests sit next to the code as `*.test.ts`.

### 9.5 `apps/web/`
```
apps/web/
├── index.html                    # root HTML; loads /boot-prefs.js then /src/main.tsx
├── package.json                  # @pallet/web, ESM; scripts dev, build, preview, typecheck, test, test:e2e
├── vite.config.ts                # tanstackRouter plugin, react, tailwindcss; dev proxy /api → http://localhost:3000; vitest config
├── components.json               # shadcn config (style new-york, tailwind v4, aliases @/components, @/lib)
├── tsconfig.json                 # moduleResolution bundler, jsx react-jsx, paths @/* → ./src/*
├── playwright.config.ts          # chromium project, baseURL, webServer (api + vite preview), screenshot settings
├── public/
│   ├── boot-prefs.js             # applies language/dir/theme/font size before first paint (7.1)
│   └── favicon.svg
├── src/
│   ├── main.tsx                  # mounts <App/> (7.1)
│   ├── app.tsx                   # providers, session bootstrap and the boot screen
│   ├── router.ts                 # router instance and typed context
│   ├── routeTree.gen.ts          # generated by @tanstack/router-plugin (committed)
│   ├── routes/                   # file-based routes (7.2): __root, login, change-password, _app/**, _print/**
│   ├── features/                 # per module: api.ts (query options), forms, sections; small pages keep theirs in routes/
│   │   ├── orders/  returns/  payments/  customers/  drivers/  items/  reports/
│   │   └── receipt/              # receipt components, receipt.css, receipt.test.tsx
│   ├── components/
│   │   ├── ui/                   # shadcn-generated components after the RTL audit (7.11.1)
│   │   └── app/                  # application components (7.5)
│   ├── hooks/                    # use-api-error-handler, use-count-up, use-debounced-value, use-page-title, use-direction, use-logical-side
│   ├── lib/
│   │   ├── api-client.ts         # apiFetch, apiUpload (7.7)
│   │   ├── api-error.ts          # ApiError, including the client-only NETWORK_ERROR / UNKNOWN_ERROR
│   │   ├── auth-store.ts         # the in-memory session (never localStorage, §10.1 S7)
│   │   ├── permission-selection.ts # dependency-aware ticking for the permission matrix
│   │   ├── generate-password.ts  # readable initial password from crypto.getRandomValues
│   │   ├── auth.ts               # in-memory auth store, bootstrap, proactive refresh, can()
│   │   ├── refresh-lock.ts       # Web Locks + BroadcastChannel refresh serialization
│   │   ├── route-guards.ts       # requireAuthenticated, requirePermission, requireAnyPermission, requireAdmin, ForbiddenError
│   │   ├── query-client.ts       # QueryClient defaults (7.8.1)
│   │   ├── query-keys.ts         # qk factory (7.8.2)
│   │   ├── errors.ts             # handleApiError (7.7.4)
│   │   ├── idempotency.ts        # useIdempotencyKey (7.7.6)
│   │   ├── preferences.ts        # PreferencesProvider and persistence
│   │   ├── zod-i18n.ts           # zod customError → i18n keys
│   │   ├── motion.ts             # motion tokens (7.14)
│   │   └── utils.ts              # cn() (clsx + tailwind-merge)
│   ├── i18n/
│   │   ├── index.ts              # i18next init (7.10)
│   │   ├── i18next.d.ts          # typed keys
│   │   ├── locales/ckb.json      # Kurdish Sorani (default)
│   │   ├── locales/ar.json       # Arabic
│   │   ├── locales/en.json       # English (type source)
│   │   ├── keys.ts               # TranslationKey, dynamicKey (8.9)
│   │   └── locales.test.ts       # completeness test
│   ├── styles/
│   │   └── globals.css           # Tailwind import, theme tokens, font stack, reduced-motion rules, print rules for reports
│   └── test/
│       └── rtl-classes.test.ts   # forbids physical-direction classes (7.11); jsdom is chosen per test file
└── e2e/
    ├── fixtures.ts               # seeded users/logins, preference init scripts
    ├── auth.spec.ts              # login, forced password change, logout
    ├── daily-flows.spec.ts       # new order, record return, record payment in ckb
    ├── receipt.spec.ts           # print route, chunking, PDF page count
    ├── rtl.spec.ts               # ckb screenshots at 1280 and 390 widths
    ├── responsive.spec.ts        # no horizontal scroll at 390 px on every route
    └── __screenshots__/          # committed screenshot baselines
```

### 9.6 `deploy/`
```
deploy/
├── caddy/
│   ├── Dockerfile                # stage 1: node builds @pallet/web; stage 2: caddy:2.11.4-alpine with /srv = web dist
│   └── Caddyfile                 # HTTPS, HSTS, security headers, /api/* → api:3000, SPA fallback to /index.html
├── postgres/
│   └── init/01-roles.sh          # first boot only: pallet_owner, pallet_app, database pallet (+ pallet_test when PALLET_CREATE_TEST_DB=true)
├── backup/
│   ├── backup.sh                 # nightly pg_dump + uploads → restic off-site, retention, healthchecks ping
│   ├── restore.sh                # restore a snapshot onto a stack (runbook companion)
│   ├── disk-alert.sh             # 15-minute disk usage alert (healthchecks ping)
│   └── backup.env.example        # template for /etc/pallet/backup.env (restic repository, keys, healthchecks URLs)
└── deploy.sh                     # deploy or roll back to a git sha: pull, migrate, up -d, health check, auto-rollback
```
Host cron entries (§13.6) and the VPS hardening commands (§10) are documented as text, not as files. Rolling back is `deploy/deploy.sh <previous-sha>` (docs/runbooks/rollback.md).

### 9.7 `docs/`
```
docs/
├── README.md                     # index of documents and runbooks
├── iterations.md                 # §15 cut into iterations + the per-iteration ritual and review rules
├── rtl-audit.md                  # created in M6: shadcn RTL audit checklist and contrast ratios (7.11.1, 7.12)
└── runbooks/
    ├── deploy.md                 # deploy a new version
    ├── rollback.md               # roll back to the previous version
    ├── restore-from-backup.md    # restore database and uploads from restic
    ├── quarterly-restore-test.md # fresh-VPS restore test from off-site material only
    ├── rotate-secrets.md         # JWT secret, DB passwords, backup key
    ├── manage-users.md           # add, deactivate, reset password
    ├── unlock-account.md         # clear login_throttles rows for (ip, username)
    ├── last-admin-recovery.md    # direct DB procedure when no admin can log in
    └── upgrade-node-postgres.md  # Node, Postgres and major library upgrades
```


## 10. Security

Every requirement of the client query §6A appears below as one row: requirement → library → exact setting/value → file. Paths are relative to the repository root. `env.X` means the value parsed by `apps/api/src/config/env.ts` (zod schema; the process exits at startup when a variable is missing or invalid).

### 10.1 Authentication and sessions

| # | Requirement | Library | Exact setting / value | Configured in |
|---|---|---|---|---|
| S1 | Password hashing | `argon2` 0.45.1 | `argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })`; `argon2.verify(hash, pw)`; after a successful login, if `argon2.needsRehash(hash, PARAMS)` is true the hash is recomputed and stored in the same transaction | `apps/api/src/modules/auth/password.service.ts` |
| S2 | Password policy | `zod` 4.6.2 | `passwordSchema = z.string().min(10).max(128)` → codes `PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG` (mapped from `too_small`/`too_big` on the password field by the auth service, not `VALIDATION_FAILED`); lowercase candidate ∈ common set → `PASSWORD_TOO_COMMON`; candidate (lowercased) = username → `PASSWORD_TOO_COMMON`; new = current → `PASSWORD_SAME_AS_CURRENT` | `packages/shared/src/schemas/auth.ts`, `apps/api/src/modules/auth/password-policy.ts` |
| S3 | Bundled common-password list | none (text file) | `apps/api/src/modules/auth/common-passwords.txt` = SecLists `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt`, entries with length ≥ 10, lowercased, de-duplicated, one per line, UTF-8; loaded once into a `Set<string>` at module init; copied to `dist/` by the API `copy-assets` script (`mkdir -p dist/modules/auth && cp src/modules/auth/common-passwords.txt dist/modules/auth/`), which both `build` and `dev` run because `tsconfig.build.json` does not copy assets | same folder |
| S4 | No username enumeration | `argon2` | `DUMMY_HASH` = `argon2.hash(randomBytes(32).toString('hex'), PARAMS)` computed in `onModuleInit`. Every login attempt performs **exactly one** `argon2.verify`: unknown username, inactive user and locked (ip, username) pair verify the submitted password against `DUMMY_HASH` and then fail. Every failure returns HTTP 401 `AUTH_INVALID_CREDENTIALS`, identical body | `apps/api/src/modules/auth/auth.service.ts` |
| S5 | Login auditing | — | `LOGIN_SUCCESS`, `LOGIN_FAILURE` (params `reason`: `INVALID` \| `LOCKED` \| `INACTIVE` — stored only in the audit row, never in the response), `LOCKOUT`; each with `ip`, `requestId`, `usernameAttempt` | §11 |
| S6 | Access token | `@nestjs/jwt` 11.0.2 | `JwtModule.registerAsync({ secret: env.JWT_ACCESS_SECRET, signOptions: { algorithm: 'HS256', expiresIn: '15m' }, verifyOptions: { algorithms: ['HS256'] } })`; payload exactly `{ sub: String(userId), tv: tokenVersion }` (+ `iat`, `exp`); the token is read from `Authorization: Bearer` by `AuthGuard`; `env.JWT_ACCESS_SECRET` min length 64 | `apps/api/src/modules/auth/auth.module.ts`, `common/guards/auth.guard.ts` |
| S7 | Access token in memory only | — | returned in JSON `{ accessToken, accessTokenExpiresAt, user }`; stored in a module-level variable in `apps/web/src/lib/auth-store.ts`; never written to `localStorage`, `sessionStorage`, IndexedDB or cookies. ESLint `no-restricted-properties` forbids `localStorage.setItem` outside `apps/web/src/lib/preferences.ts` | web |
| S8 | DB check on every request | Prisma | `AuthGuard` verifies the token, then loads `user` + `permissions` by `sub`; rejects with `AUTH_TOKEN_INVALID` when the user is missing, `isActive = false` or `tokenVersion ≠ tv`; a `TokenExpiredError` → `AUTH_TOKEN_EXPIRED`; no header → `AUTH_REQUIRED` | `apps/api/src/common/guards/auth.guard.ts` |
| S9 | Refresh token | Node `crypto` | value = `randomBytes(32).toString('base64url')`; DB stores `sha256(value)` hex in `refresh_tokens.token_hash` (CHAR 64, UNIQUE) | `apps/api/src/modules/auth/session.service.ts` |
| S10 | Refresh cookie | `cookie-parser` 1.4.7 | `res.cookie('pallet_rt', value, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path: '/api/auth', maxAge: expiresAt − now })`; cleared with `res.clearCookie('pallet_rt', { path: '/api/auth', httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict' })`. `COOKIE_SECURE` = `true` in production (compose hard-codes it) | `apps/api/src/modules/auth/auth.controller.ts` |
| S11 | Lifetimes | — | `REFRESH_SLIDING_MS = 14 × 24 × 3600 × 1000`; `SESSION_ABSOLUTE_MS = 30 × 24 × 3600 × 1000`; new token `expiresAt = min(now + REFRESH_SLIDING_MS, family.absoluteExpiresAt)`; `family.absoluteExpiresAt = family.createdAt + SESSION_ABSOLUTE_MS` | `apps/api/src/modules/auth/auth.constants.ts` |
| S12 | Rotation, reuse detection, grace window | Prisma, raw lock | family row locked `SELECT id FROM session_families WHERE id = ${familyId}::uuid FOR UPDATE`; algorithm steps (1)–(5) of §6 auth flow; `REFRESH_GRACE_MS = 30_000`; reuse → family `revoked_reason = 'REUSE_DETECTED'`, all tokens `REVOKED`, audit `SESSION_REUSE_DETECTED` | `session.service.ts` |
| S13 | Cross-tab refresh serialisation | Web Locks API, `BroadcastChannel` | `navigator.locks.request('pallet-auth-refresh', { mode: 'exclusive' }, refreshOnce)`; fallback when `navigator.locks` is undefined: channel `pallet-auth`, message `{ type: 'refresh-start' \| 'refresh-done', tabId }`; a tab that saw `refresh-start` from another tab waits for `refresh-done` up to 3 000 ms, then refreshes itself. One in-flight refresh promise per tab | `apps/web/src/lib/auth/refresh-lock.ts` |
| S14 | Logout this device / everywhere | — | logout: revoke family of the cookie (`LOGOUT`), clear cookie, 204 (also 204 when the cookie is missing or unknown). Logout-all: revoke every non-revoked family of the user (`LOGOUT_ALL`) + `tokenVersion += 1`, clear cookie, 204 | `auth.controller.ts`, `users.controller.ts` (admin variant) |
| S15 | Server-side revocation | — | deactivation → `USER_DEACTIVATED`; admin reset → `PASSWORD_RESET`; own change → `PASSWORD_CHANGED`; each: revoke all families + `tokenVersion += 1` in the same transaction; own change then creates a new family and returns a fresh access token + cookie. Permission / role changes revoke nothing | `users.service.ts`, `auth.service.ts` |
| S16 | Same origin + CSRF | Caddy, Nest guard | web and API both served by Caddy on one origin; `CsrfGuard` (global, before `AuthGuard`): for methods `POST`, `PUT`, `PATCH`, `DELETE` require header `X-Requested-With: pallet-web` exactly, else 403 `CSRF_HEADER_MISSING`; the web API client sets it on every request | `apps/api/src/common/guards/csrf.guard.ts`, `apps/web/src/lib/api-client.ts` |
| S17 | Must-change-password gate | — | `PasswordChangeGuard` (global, after `AuthGuard`): when `user.mustChangePassword` and the route is not one of `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/logout`, `POST /api/auth/logout-all`, `POST /api/auth/refresh` → 403 `PASSWORD_CHANGE_REQUIRED` | `apps/api/src/common/guards/password-change.guard.ts` |

### 10.2 Rate limiting and abuse

| # | Requirement | Library | Exact setting / value | Configured in |
|---|---|---|---|---|
| R1 | Real client IP | Express | `app.set('trust proxy', env.TRUST_PROXY_SUBNET)`; production value `172.28.0.0/24` (subnet pinned in `docker-compose.yml`, Caddy at `172.28.0.10`); development value `loopback`. Caddy sets `X-Forwarded-For` to the TCP peer address and does not trust incoming values (no `trusted_proxies` configured) | `apps/api/src/main.ts`, `docker-compose.yml`, `deploy/caddy/Caddyfile` |
| R2 | Global throttle | `@nestjs/throttler` 6.5.0 | throttler `{ name: 'global', ttl: 60_000, limit: 600 }`, tracker `req.ip`, in-memory storage (single API instance) | `apps/api/src/app.module.ts` |
| R3 | Login per-IP cap | `@nestjs/throttler` | `{ name: 'login', ttl: 60_000, limit: 60, skipIf: (ctx) => !isRoute(ctx, 'POST', '/api/auth/login') }` | `apps/api/src/common/guards/app-throttler.guard.ts` |
| R4 | Refresh cap | `@nestjs/throttler` | `{ name: 'refresh', ttl: 60_000, limit: 60, skipIf: (ctx) => !isRoute(ctx, 'POST', '/api/auth/refresh') }` | same |
| R5 | Upload cap per user | `@nestjs/throttler` storage | controller-level `UploadThrottleGuard` (runs after the global `AuthGuard`, so the user is known): `storage.increment('upload:' + userId, 60_000, 10, 0, 'upload')`; over limit → 429 | `apps/api/src/modules/uploads/upload-throttle.guard.ts` |
| R6 | 429 response | — | `AppThrottlerGuard extends ThrottlerGuard` overrides `throwThrottlingException` → `ApiError('RATE_LIMITED', { retryAfterSeconds })` and sets `Retry-After` | `apps/api/src/common/guards/app-throttler.guard.ts` |
| R7 | Login lockout keyed on (IP, username) | Prisma | table `login_throttles` PK `(ip, username)`; `LOCKOUT_THRESHOLD = 5`, `LOCKOUT_WINDOW_MS = 15 × 60_000`, backoff `lockedUntil = now + min(15 min, 60_000 × 2^lockoutCount)` then `lockoutCount += 1`; window expired → `failureCount = 0`, `windowStartedAt = now`; success → row deleted; hourly job deletes rows with `updated_at < now − 24 h`. Per-username-only lockout is forbidden | `apps/api/src/modules/auth/login-throttle.service.ts` |
| R8 | Worked example | — | failures 1–4 at 09:00–09:04 → allowed; 5th at 09:05 → `lockedUntil = 09:06` (2⁰ min), `lockoutCount = 1`; attempt 09:05:30 → rejected unverified-password path (dummy verify) + `LOGIN_FAILURE reason LOCKED`; 09:06:10 wrong password → `failureCount = 6 ≥ 5` → `lockedUntil = 09:08` (2¹ min), `lockoutCount = 2`; subsequent locks 4, 8, 15, 15 min | — |

### 10.3 Authorization

| # | Requirement | Setting | File |
|---|---|---|---|
| Z1 | Every endpoint declares its permission | decorators `@Public()`, `@Authenticated()`, `@AdminOnly()`, `@RequirePermission(...keys)` (all listed keys required), `@RequireAnyPermission(...keys)` (at least one); exactly one per handler. `PermissionDeclarationCheck.onApplicationBootstrap()` uses `DiscoveryService` + `MetadataScanner` over every controller method with a route; throws `Error('Route <METHOD> <path> has no permission declaration')` → process exits 1. Vitest `permission-declaration.check.test.ts` boots `AppModule` so CI fails | `apps/api/src/common/decorators/*.ts`, `apps/api/src/common/checks/permission-declaration.check.ts` |
| Z2 | Server-side enforcement | `PermissionGuard` (global, last): admin → allow all; employee → check stored keys; missing → 403 `PERMISSION_DENIED` with `details.required` | `apps/api/src/common/guards/permission.guard.ts` |
| Z3 | Admin-only by role | `@AdminOnly()` → `user.role === 'ADMIN'` else 403 `ADMIN_ONLY`; `confirmCreditOverride: true` from a non-admin → 403 `ADMIN_ONLY` (checked in the order service before any write) | same |
| Z4 | Cost field stripping | response mappers take `ctx.canViewCost = role === 'ADMIN' \|\| permissions.has('items.viewCost')`; when false the keys `unitCost`, `totalCost` are **omitted** from batch DTOs, from item detail `batches[]`, and from audit `before`/`after` (§11.5); `GET /api/reports/purchases` re-asserts `items.viewCost` in the service (403 `PERMISSION_DENIED`) | `apps/api/src/modules/purchases/purchase-batch.mapper.ts`, `apps/api/src/modules/audit/audit-redaction.ts` |
| Z5 | Client-side hiding | `useCan(key)` hides/disables UI; never trusted by the API | `apps/web/src/lib/auth.ts` |

### 10.4 Input, output and uploads

| # | Requirement | Library | Exact setting / value | File |
|---|---|---|---|---|
| I1 | Strict validation | `zod` 4.6.2 | every request schema is `z.strictObject({...})` from `@pallet/shared`; unknown key → `VALIDATION_FAILED` with field code `unknown_key`; `ZodValidationPipe` maps zod issue codes: `invalid_type`→`invalid_type` (or `required` when input is `undefined`), `too_small`/`too_big` (numbers) and `too_short`/`too_long` (strings by `origin`), `invalid_format`, `invalid_value`→`invalid_enum`, `unrecognized_keys`→`unknown_key`, custom → the `params.code` given by the schema | `apps/api/src/common/pipes/zod-validation.pipe.ts` |
| I2 | Body size | Express | the app is created with `bodyParser: false` and `configureApp` registers only `app.useBodyParser('json', { limit: 100 KiB })`; no urlencoded parser; body-parser's plain errors (`entity.too.large`, `entity.parse.failed`) are mapped by `ApiExceptionFilter` to 413 `PAYLOAD_TOO_LARGE { maxBytes }` and 400 `VALIDATION_FAILED` rather than falling through as 500 | `apps/api/src/bootstrap.ts`, `common/filters/api-exception.filter.ts` |
| I3 | Parameterised SQL only | Prisma, ESLint | raw SQL only via `tx.$queryRaw\`…\`` / `tx.$executeRaw\`…\``; ESLint `no-restricted-properties` for `$queryRawUnsafe`, `$executeRawUnsafe`; dynamic `ORDER BY` built only from a whitelist map `{ name: Prisma.sql\`c.name\` }` | `eslint.config.mjs` |
| I4 | No `dangerouslySetInnerHTML` | ESLint | `no-restricted-syntax: ["error", { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']" }]` | `eslint.config.mjs` |
| I5 | Upload intake | `multer` 2.x via `FileInterceptor('file', …)` | `storage: memoryStorage()`, `limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 2 }` (Q35); oversize → 413 `UPLOAD_TOO_LARGE`; no file → 400 `UPLOAD_MISSING_FILE` | `apps/api/src/modules/uploads/uploads.controller.ts` |
| I6 | Type by magic bytes | `sharp` 0.35.4 | `sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata()`; the magic bytes are checked first and `format ∉ {'png','jpeg','webp'}` → 415 `UPLOAD_TYPE_NOT_ALLOWED`; sharp throws → 400 `UPLOAD_INVALID_IMAGE`. The client-sent MIME type and filename are ignored (Q35) | `apps/api/src/modules/uploads/image-processor.ts` |
| I7 | Re-encode | `sharp` | `.rotate().resize({ width: W, height: W, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()`; `W = 1600` for `ITEM_IMAGE`, `800` for `FACTORY_LOGO`; metadata (EXIF, ICC, XMP) is dropped because `.keepMetadata()`/`.withMetadata()` are never called; animated inputs keep only the first frame (sharp default `pages: 1`) | same |
| I8 | Storage | Node `fs` | name `randomBytes(16).toString('hex') + '.webp'`; `fs.writeFile(join(env.UPLOADS_DIR, name), buf, { flag: 'wx', mode: 0o640 })`; `env.UPLOADS_DIR` = `/data/uploads` (volume `uploads`, outside any web root); DB row in `uploads` | `apps/api/src/modules/uploads/uploads.service.ts` |
| I9 | Serving | Express `res.sendFile` | `GET /api/uploads/:fileName`, `fileName` must match `^[0-9a-f]{32}\.webp$` else 404; `res.sendFile(fileName, { root: env.UPLOADS_DIR, dotfiles: 'deny', headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' } })` | `uploads.controller.ts` |

### 10.5 Transport and headers

| # | Requirement | Exact setting | File |
|---|---|---|---|
| T1 | HTTPS + automatic certificates | Caddy site block `{$APP_DOMAIN}`, global `email {$ACME_EMAIL}`; certificates in volume `caddy_data` (survives container recreation) | `deploy/caddy/Caddyfile`, `docker-compose.yml` |
| T2 | HTTP → HTTPS | Caddy automatic redirect (default for a hostname site) | Caddyfile |
| T3 | HSTS | `Strict-Transport-Security "max-age=31536000; includeSubDomains"` | Caddyfile |
| T4 | CSP | `Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"` (verbatim from the client query). Consequence: no inline `<script>` in `index.html`; preferences boot script is the external file `/boot-prefs.js` | Caddyfile, `apps/web/public/boot-prefs.js` |
| T5 | Other headers | `X-Content-Type-Options "nosniff"`, `Referrer-Policy "strict-origin-when-cross-origin"`, `Permissions-Policy "camera=(), microphone=(), geolocation=()"`, `-Server`; API: `app.disable('x-powered-by')` | Caddyfile, `main.ts` |
| T6 | Static caching | `/assets/*` → `Cache-Control "public, max-age=31536000, immutable"`; every other static path → `no-cache`; SPA fallback `try_files {path} /index.html` | Caddyfile |
| T7 | CORS | production: not registered (same origin). Development: `app.enableCors({ origin: env.CORS_DEV_ORIGIN, credentials: true })` only when `NODE_ENV === 'development'` and `CORS_DEV_ORIGIN` is non-empty (the default dev setup uses the Vite proxy and needs no CORS) | `main.ts` |

### 10.6 Data and infrastructure

| # | Requirement | Exact setting | File |
|---|---|---|---|
| D1 | Only Caddy publishes ports | `ports:` exists only on `caddy` (`80`, `443`, `443/udp`). Docker's iptables rules bypass UFW, so the firewall for `api`/`postgres` is the absence of `ports:` — a comment in `docker-compose.yml` forbids adding them | `docker-compose.yml` |
| D2 | Least-privilege DB roles | `pallet_owner` (migrations, seeds), `pallet_app` (runtime) with the grant matrix of §5; app role has no `UPDATE`/`DELETE` on `audit_logs`, `stock_movements`, `ledger_entries`, `return_lines`, and only column-level `UPDATE` on `returns` reversal columns; triggers `forbid_update_delete` as defence in depth | `deploy/postgres/init/01-roles.sh`, `apps/api/prisma/sql/grants.sql`, migrations |
| D3 | Secrets only in env | `.env` (mode 600) on the VPS; `.env*` in `.gitignore` and `.dockerignore`; zod env schema never logs values; `SENTRY_DSN` optional | `.env.example`, `apps/api/src/config/env.ts` |
| D4 | Rotation + escrow | runbook `docs/runbooks/rotate-secrets.md`; escrow list §13.6 | docs |
| D5 | VPS hardening | see §10.7 commands | host |
| D6 | Containers | `api`, `migrate`: image `USER node`, `read_only: true`, `tmpfs: /tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`; `caddy`: runs as the image's root user (needs to bind 80/443) with `cap_drop: [ALL]`, `cap_add: [NET_BIND_SERVICE]`, `read_only: true`; `postgres`: official image (drops to user `postgres` itself); every image pinned to an exact version tag | `docker-compose.yml`, Dockerfiles |
| D7 | Dependency hygiene | Dependabot weekly (npm, docker, docker-compose, github-actions; majors of NestJS/TypeScript/Prisma/Node ignored — upgraded by runbook); CI `pnpm audit --audit-level=high` fails the build; `pnpm-workspace.yaml` `onlyBuiltDependencies` allowlist; exact versions (`save-exact=true`); GitHub Actions pinned to commit SHAs | `.github/dependabot.yml`, `.github/workflows/ci.yml` |
| D8 | Structured logs | `nestjs-pino` 4.6.1: `pinoHttp: { level: env.LOG_LEVEL, genReqId: (req, res) => { const id = randomUUID(); res.setHeader('X-Request-Id', id); return id; }, redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'req.body', 'res.body', '*.password', '*.currentPassword', '*.newPassword', '*.passwordHash', '*.accessToken', '*.refreshToken', '*.token', '*.tokenHash'], censor: '[REDACTED]' }, serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url, ip: r.ip }) }, autoLogging: { ignore: (req) => req.url === '/api/health' } }`; stdout only; Docker `json-file` `max-size: 50m`, `max-file: 30` | `apps/api/src/app.module.ts`, `docker-compose.yml` |
| D9 | API error alerting | `@sentry/nestjs` 10.74.0, loaded only when `SENTRY_DSN` is set: `Sentry.init({ dsn, environment: env.SENTRY_ENVIRONMENT, release: env.APP_VERSION, sendDefaultPii: false, tracesSampleRate: 0, beforeSend: scrubEvent })` in `src/instrument.ts` imported first by `main.ts`; `scrubEvent` (`src/sentry-scrub.ts`) deletes the request's cookies, data, `authorization` and `cookie` headers and its query string (`query_string`, and the query cut from `url` — a list search is a customer's name or phone); `ApiExceptionFilter` calls `Sentry.captureException` for 5xx only | `apps/api/src/instrument.ts`, `apps/api/src/sentry-scrub.ts` |
| D10 | Browser error reporting | **not implemented** (CSP `connect-src 'self'` would block it; adding it requires adding the tracker origin to `connect-src`) | — |
| D11 | Uptime / disk | external uptime check on `/api/health`; `deploy/backup/disk-alert.sh` every 15 min | §13.8 |

### 10.7 VPS hardening (Ubuntu 24.04 LTS, run once as root)

```bash
adduser --disabled-password --gecos "" deploy && usermod -aG docker,sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh   # then add the maintainer + CI public keys to authorized_keys
cat >/etc/ssh/sshd_config.d/99-pallet.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 3
EOF
systemctl restart ssh
apt-get update && apt-get install -y ufw fail2ban unattended-upgrades restic git rsync
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades        # security updates only (Ubuntu default origins)
printf '[sshd]\nenabled = true\nmaxretry = 5\nbantime = 1h\n' >/etc/fail2ban/jail.d/sshd.local && systemctl enable --now fail2ban
timedatectl set-timezone UTC
# Docker Engine from Docker's apt repository (docs.docker.com/engine/install/ubuntu), then:
printf '{ "log-driver": "json-file", "log-opts": { "max-size": "50m", "max-file": "30" }, "live-restore": true }\n' >/etc/docker/daemon.json && systemctl restart docker
```


## 11. Audit log design

### 11.1 Storage and guarantees

- Table `audit_logs` (§5): `id`, `created_at` (UTC), `user_id` (nullable: login failures for unknown usernames), `username_attempt` (login events only, lowercased, truncated to 64), `action` (`AuditAction`), `entity_type` (`AuditEntityType`), `entity_id` (text: integer ids as decimal strings, session family uuid), `summary_key`, `summary_params` (jsonb), `ip`, `request_id`, `before` (jsonb), `after` (jsonb).
- **Append-only:** no endpoint updates or deletes audit rows; `pallet_app` has only `SELECT, INSERT`; trigger `forbid_update_delete` raises on `UPDATE`/`DELETE` for every role (a restore uses `pg_restore` into an empty database, which only inserts).
- **Same transaction:** every mutation writes its audit row(s) through `AuditService.record(tx, entry)` using the transaction client of the mutation; if the mutation rolls back, the audit row does too. Login success/failure/lockout rows are written in their own short transaction together with the `login_throttles` / `session_families` change they describe.
- **Context capture:** `RequestContext` (`apps/api/src/common/context/request-context.ts`, Node `AsyncLocalStorage`) is populated by a middleware with `requestId` (the pino request id, also returned as `X-Request-Id`) and `ip` (`req.ip`, already resolved through `trust proxy`), and by `AuthGuard` with `userId`. `AuditService.record` reads them; callers never pass them.
- **Retention:** kept forever (estimated < 150 MB per year at this scale). No purge job.
- **Indexes:** `(created_at)`, `(user_id, created_at)`, `(entity_type, entity_id)`, `(action, created_at)` — match the History page filters. Listing query: `WHERE` = conjunction of the supplied filters; `ORDER BY created_at DESC, id DESC`; offset pagination (`pageSize` ≤ 100).
- **Summary rendering:** the API never stores or returns prose. `summary_key` = `audit.summary.<ENTITY_TYPE>.<ACTION>`; the web app renders `t(summaryKey, summaryParams)` in the viewer's language. Every key in §11.3 must exist in all three locale files (checked by the i18n completeness test).

### 11.2 Snapshot rules (`before` / `after`)

| Action kind | `before` | `after` |
|---|---|---|
| `CREATE`, `UPLOAD_CREATE` | null | full snapshot of the created row |
| `UPDATE`, `SETTINGS_CHANGE`, `PERMISSION_CHANGE` | snapshot before the change | snapshot after the change |
| `DELETE` (archive / batch soft delete), `CANCEL`, `USER_DEACTIVATE`, `USER_ACTIVATE` | snapshot before | snapshot after |
| `STOCK_ADJUST` | `{ quantityOnHand }` before | `{ quantityOnHand, movement: { quantity, note } }` after |
| `PAYMENT_CREATE`, `REFUND_CREATE`, `PAYMENT_REVERSE`, `REFUND_REVERSE` | null | the ledger row snapshot |
| `RETURN_CREATE` | null | return snapshot with `lines[]` |
| `RETURN_EDIT`, `RETURN_DELETE` | old return snapshot | `RETURN_EDIT`: new return snapshot; `RETURN_DELETE`: `{ reversedAt, reversalKind: 'DELETE' }` |
| `CREDIT_OVERRIDE` | null | `{ creditLimit, customerOutValue, depositDelta, excess }` |
| `LOGIN_*`, `LOCKOUT`, `LOGOUT`, `LOGOUT_ALL`, `SESSION_REUSE_DETECTED`, `PASSWORD_CHANGE`, `PASSWORD_RESET` | null | null (details only in `summary_params`) |

A **snapshot** is produced by `toAuditSnapshot(entityType, row)` (`apps/api/src/modules/audit/audit-snapshot.ts`): camelCase keys, money and quantities as JSON numbers, business dates as `YYYY-MM-DD`, timestamps as ISO UTC strings, relations reduced to ids plus a display name (`customerName`, `itemName`, `driverName`), `version` included. Orders include `lines[]` (`itemId`, `itemName`, `quantity`, `unitDeposit`, `lineTotal`).

### 11.3 Action × entity matrix (exhaustive)

| Entity type | Action | Written by | `entity_id` | `summary_key` | `summary_params` |
|---|---|---|---|---|---|
| USER | CREATE | POST /api/users | user id | `audit.summary.USER.CREATE` | `username`, `role` |
| USER | UPDATE | PATCH /api/users/:id (displayName/role) | user id | `audit.summary.USER.UPDATE` | `username`, `fields` (array of changed field names) |
| USER | USER_DEACTIVATE | PATCH isActive=false | user id | `audit.summary.USER.USER_DEACTIVATE` | `username` |
| USER | USER_ACTIVATE | PATCH isActive=true | user id | `audit.summary.USER.USER_ACTIVATE` | `username` |
| USER | PERMISSION_CHANGE | PUT /api/users/:id/permissions | user id | `audit.summary.USER.PERMISSION_CHANGE` | `username`, `added` (count), `removed` (count) — full key arrays in `before`/`after` as `{ permissions: [...] }` |
| USER | PASSWORD_RESET | POST /api/users/:id/reset-password | user id | `audit.summary.USER.PASSWORD_RESET` | `username` |
| USER | PASSWORD_CHANGE | POST /api/auth/change-password | user id | `audit.summary.USER.PASSWORD_CHANGE` | `username` |
| USER | LOGOUT_ALL | POST /api/auth/logout-all, POST /api/users/:id/logout-all | user id | `audit.summary.USER.LOGOUT_ALL` | `username`, `families` (count revoked) |
| SESSION | LOGIN_SUCCESS | POST /api/auth/login | family uuid | `audit.summary.SESSION.LOGIN_SUCCESS` | `username` |
| USER | LOGIN_FAILURE | POST /api/auth/login | user id or null | `audit.summary.USER.LOGIN_FAILURE` | `usernameAttempt`, `reason` (`INVALID` \| `LOCKED` \| `INACTIVE`) |
| USER | LOCKOUT | POST /api/auth/login (5th failure) | user id or null | `audit.summary.USER.LOCKOUT` | `usernameAttempt`, `lockedMinutes`, `lockoutCount` |
| SESSION | LOGOUT | POST /api/auth/logout | family uuid | `audit.summary.SESSION.LOGOUT` | `username` |
| SESSION | SESSION_REUSE_DETECTED | POST /api/auth/refresh | family uuid | `audit.summary.SESSION.SESSION_REUSE_DETECTED` | `username` |
| SETTINGS | SETTINGS_CHANGE | PUT /api/settings | `1` | `audit.summary.SETTINGS.SETTINGS_CHANGE` | `fields` |
| UPLOAD | UPLOAD_CREATE | POST /api/uploads | upload id | `audit.summary.UPLOAD.UPLOAD_CREATE` | `kind`, `width`, `height` |
| ITEM | CREATE | POST /api/items | item id | `audit.summary.ITEM.CREATE` | `name`, `depositPrice`, `initialQuantity` (0 when no batch) |
| ITEM | UPDATE | PATCH /api/items/:id | item id | `audit.summary.ITEM.UPDATE` | `name`, `fields` |
| ITEM | DELETE | DELETE /api/items/:id (archive) | item id | `audit.summary.ITEM.DELETE` | `name` |
| ITEM | STOCK_ADJUST | POST /api/items/:id/stock-adjustments | item id | `audit.summary.ITEM.STOCK_ADJUST` | `name`, `quantity` (signed) |
| PURCHASE_BATCH | CREATE | POST /api/purchase-batches, POST /api/items with `initialBatch` | batch id | `audit.summary.PURCHASE_BATCH.CREATE` | `itemName`, `quantity`, `date` — **never cost** |
| PURCHASE_BATCH | UPDATE | PATCH /api/purchase-batches/:id | batch id | `audit.summary.PURCHASE_BATCH.UPDATE` | `itemName`, `quantity`, `fields` (field names only; `unitCost` may appear as a name, never as a value) |
| PURCHASE_BATCH | DELETE | DELETE /api/purchase-batches/:id | batch id | `audit.summary.PURCHASE_BATCH.DELETE` | `itemName`, `quantity` |
| CUSTOMER | CREATE | POST /api/customers | customer id | `audit.summary.CUSTOMER.CREATE` | `name` |
| CUSTOMER | UPDATE | PATCH /api/customers/:id | customer id | `audit.summary.CUSTOMER.UPDATE` | `name`, `fields` |
| CUSTOMER | DELETE | DELETE /api/customers/:id | customer id | `audit.summary.CUSTOMER.DELETE` | `name` |
| DRIVER | CREATE | POST /api/drivers | driver id | `audit.summary.DRIVER.CREATE` | `name` |
| DRIVER | UPDATE | PATCH /api/drivers/:id | driver id | `audit.summary.DRIVER.UPDATE` | `name`, `fields` |
| DRIVER | DELETE | DELETE /api/drivers/:id | driver id | `audit.summary.DRIVER.DELETE` | `name` |
| ORDER | CREATE | POST /api/orders | order id | `audit.summary.ORDER.CREATE` | `orderNumber`, `customerName`, `paymentType`, `depositTotal` |
| ORDER | UPDATE | PATCH /api/orders/:id | order id | `audit.summary.ORDER.UPDATE` | `orderNumber`, `fields` (`lines` when lines changed) |
| ORDER | CANCEL | POST /api/orders/:id/cancel | order id | `audit.summary.ORDER.CANCEL` | `orderNumber`, `customerName` |
| ORDER | CREDIT_OVERRIDE | POST /api/orders or PATCH lines with `confirmCreditOverride` | order id | `audit.summary.ORDER.CREDIT_OVERRIDE` | `orderNumber`, `customerName`, `excess` |
| RETURN | RETURN_CREATE | POST /api/orders/:orderId/returns | return id | `audit.summary.RETURN.RETURN_CREATE` | `orderNumber`, `accepted`, `damaged`, `refundDue`, `cashRefund` |
| RETURN | RETURN_EDIT | POST /api/returns/:id/replace | old return id | `audit.summary.RETURN.RETURN_EDIT` | `orderNumber`, `newReturnId` |
| RETURN | RETURN_DELETE | DELETE /api/returns/:id | return id | `audit.summary.RETURN.RETURN_DELETE` | `orderNumber` |
| LEDGER_ENTRY | PAYMENT_CREATE | order create (automatic), line edit (re-issued automatic), POST payments (manual) | ledger id | `audit.summary.LEDGER_ENTRY.PAYMENT_CREATE` | `orderNumber`, `amount`, `automatic` (boolean) |
| LEDGER_ENTRY | PAYMENT_REVERSE | line edit, cancel, POST /api/ledger-entries/:id/reverse | reversal row id | `audit.summary.LEDGER_ENTRY.PAYMENT_REVERSE` | `orderNumber`, `amount` |
| LEDGER_ENTRY | REFUND_CREATE | return create / replacement (only when `cashRefund > 0`) | ledger id | `audit.summary.LEDGER_ENTRY.REFUND_CREATE` | `orderNumber`, `amount` |
| LEDGER_ENTRY | REFUND_REVERSE | return edit / delete (only when the old return had a refund) | reversal row id | `audit.summary.LEDGER_ENTRY.REFUND_REVERSE` | `orderNumber`, `amount` |

One operation may write several rows, all in its transaction, in this order: primary entity row first, then `CREDIT_OVERRIDE`, then ledger rows. Order creation on a CASH order with an admin override writes `ORDER.CREATE`, `ORDER.CREDIT_OVERRIDE`, `LEDGER_ENTRY.PAYMENT_CREATE`.

### 11.4 Write-time exclusions (never stored)

`toAuditSnapshot` builds snapshots from an explicit allow-list per entity (never `...row`), so the following are never written:

| Entity | Never written |
|---|---|
| USER | `passwordHash`, `tokenVersion`; the submitted password in any form |
| SESSION | refresh token values and `tokenHash`; the audit row carries only the family uuid |
| any | request headers, cookies, access tokens; login attempts store `usernameAttempt` only |

Defence in depth: `AuditService.record` deletes, recursively, every key of `before`/`after`/`summaryParams` whose name matches `/password|token|secret/i` before insert, except the explicit non-credential exceptions in `SENSITIVE_KEY_EXCEPTIONS` (today only `mustChangePassword`, a flag the USER snapshot must keep). A unit test asserts both the stripping and the exception.

### 11.5 Read-time redaction (per viewer)

Batch cost is stored in the audit log but stripped from `GET /api/audit-logs` responses when the viewer is not an admin and lacks `items.viewCost`:

| Entity type | Paths removed from `before` and `after` |
|---|---|
| PURCHASE_BATCH | `unitCost`, `totalCost` |
| ITEM | `initialBatch.unitCost`, `initialBatch.totalCost` |

The list lives in `AUDIT_READ_REDACTIONS` (`apps/api/src/modules/audit/audit-redaction.ts`). `summary_params` never contain cost values (§11.3), so the rendered sentence is safe for every viewer. Integration test: an employee with `audit.view` but without `items.viewCost` sees a `PURCHASE_BATCH.CREATE` row without `unitCost`/`totalCost` anywhere in the JSON body.

### 11.6 History page contract

`GET /api/audit-logs?userId&entityType&entityId&action&dateFrom&dateTo&page&pageSize` (permission `audit.view`). `dateFrom`/`dateTo` are Asia/Baghdad calendar days converted to the UTC half-open interval `[dateFrom 00:00+03:00, dateTo+1 00:00+03:00)`. Response item: `{ id, createdAt, user: { id, username, displayName } | null, usernameAttempt, action, entityType, entityId, summaryKey, summaryParams, ip, requestId, before, after }`. The page links `entityId` to the entity detail route when one exists (ORDER → `/orders/$orderId`, CUSTOMER → `/customers/$customerId`, ITEM → `/items/$itemId`, USER → `/users/$userId`; RETURN and LEDGER_ENTRY → the owning order via `after.orderId` / `before.orderId`).


## 12. Reports

### 12.1 Common rules

- Implementation: `apps/api/src/modules/reports/` — `reports.controller.ts`, `reports.service.ts`, `reports.repository.ts`. Every report is one or a few SQL aggregate queries via `tx.$queryRaw` tagged templates; optional filters are composed with `Prisma.sql` / `Prisma.empty` fragments; no in-memory loops over all orders.
- Every `SUM()` over money or quantity is cast `::bigint`; the repository converts results with `toSafeMoney()` / `toSafeInt()`.
- Every query touching orders filters `o.cancelled_at IS NULL`; every query touching returns filters `r.reversed_at IS NULL`; batches filter `pb.deleted_at IS NULL`.
- Ledger effective date = `COALESCE(le.date, o.date)` (the automatic hand-over payment has no stored date).
- Date filters are business dates `YYYY-MM-DD`, inclusive on both ends: `x.date BETWEEN ${dateFrom}::date AND ${dateTo}::date`. `dateFrom > dateTo` → 400 `DATE_RANGE_INVALID`; either date after today (Baghdad) → 400 `BUSINESS_DATE_IN_FUTURE`. Defaults applied by the web app (not the API): first day of the current month → today.
- Every response carries `generatedAt` (ISO UTC) and echoes the applied `filters`; the page prints them in the header.
- Row cap: each row array is limited to 5 000 rows (`LIMIT 5001`, the 5 001st row sets `truncated: true` and is dropped); totals come from separate aggregate queries and are always complete. The UI shows "narrow the date range" when `truncated`.
- Snapshot reports (1, 4) are small (one row per customer / item) and are sorted client-side; the API returns a fixed default order.
- Print: every report page has a Print button (`window.print()`). Print CSS (`apps/web/src/styles/print.css`): `@page { size: A4 portrait; margin: 12mm }` (Activity: `A4 landscape`), hide `[data-print="hide"]` (sidebar, filters, buttons), show `[data-print="only"]` header (factory name, report title, filters, `generatedAt` in Asia/Baghdad), `thead { display: table-header-group }`, `tr { break-inside: avoid }`, forced light colours (`color-scheme: light`, `--background: #fff`), no motion.

### 12.2 Report 1 — Pallets out & money position (snapshot) — `GET /api/reports/positions`

Permission `reports.viewPositions`. Query and response: `PositionsReportQuery` (§6.23) and `PositionsReportDto` (§6.9), Q42 — the SQL below shows the aggregation; customers with nothing out, owed or held are omitted unless `includeZero`. (The SQL's `includeSettled` parameter is that `includeZero`.)

```sql
WITH per_customer AS (
  SELECT o.customer_id,
         SUM(o.out_quantity_total)::bigint AS pallets_out,
         SUM(o.out_value)::bigint          AS out_value,
         SUM(o.owed)::bigint               AS owed,
         SUM(o.held)::bigint               AS held
    FROM orders o
   WHERE o.cancelled_at IS NULL
   GROUP BY o.customer_id
), per_item AS (
  SELECT o.customer_id, ol.item_id, SUM(ol.out_quantity)::bigint AS quantity
    FROM order_lines ol
    JOIN orders o ON o.id = ol.order_id
   WHERE o.cancelled_at IS NULL AND ol.out_quantity > 0
   GROUP BY o.customer_id, ol.item_id
)
SELECT c.id, c.name, c.credit_limit,
       COALESCE(pc.pallets_out, 0) AS pallets_out, COALESCE(pc.out_value, 0) AS out_value,
       COALESCE(pc.owed, 0) AS owed, COALESCE(pc.held, 0) AS held,
       COALESCE(jsonb_agg(jsonb_build_object('itemId', pi.item_id, 'quantity', pi.quantity)
                ORDER BY pi.item_id) FILTER (WHERE pi.item_id IS NOT NULL), '[]'::jsonb) AS per_item
  FROM customers c
  LEFT JOIN per_customer pc ON pc.customer_id = c.id
  LEFT JOIN per_item pi     ON pi.customer_id = c.id
 WHERE (${customerId}::int IS NULL OR c.id = ${customerId})
   AND (${includeSettled} OR COALESCE(pc.pallets_out, 0) > 0 OR COALESCE(pc.owed, 0) > 0)
 GROUP BY c.id, pc.pallets_out, pc.out_value, pc.owed, pc.held
 ORDER BY COALESCE(pc.out_value, 0) DESC, c.name ASC;
```

Response shape superseded by the §6.9 DTO (Q42): the API sends that DTO, and fields below that it lacks (such as `filters`, `creditLimit`, `headroom`, `totalsByItem`, `totalOwned`) are not sent. Response: `{ generatedAt, filters, items: [{ id, name }], rows: [{ customerId, customerName, creditLimit|null, headroom|null, palletsOut, perItem: [{ itemId, quantity }], outValue, owed, held }], totals: { palletsOut, perItem: [{ itemId, quantity }], outValue, owed, held }, truncated }`. `items` = every item that appears in any `perItem` (id + name, archived included) to build the per-item columns. `headroom = creditLimit − outValue` (null when no limit). Totals are Σ over rows (overall `held` = Σ per-order `held`, never recomputed; §4.5). Columns sortable client-side: customer, pallets out, each item, out value, owed, held.

### 12.3 Report 2 — Purchases by period — `GET /api/reports/purchases`

Permission `reports.viewPurchases`; the service additionally requires `items.viewCost` (admins always) → else 403 `PERMISSION_DENIED`. Query params: `dateFrom`, `dateTo` (required), `itemId?`.

```sql
-- rows
SELECT pb.id, pb.item_id, i.name AS item_name, pb.date, pb.quantity, pb.unit_cost, pb.total_cost
  FROM purchase_batches pb JOIN items i ON i.id = pb.item_id
 WHERE pb.deleted_at IS NULL
   AND pb.date BETWEEN ${dateFrom}::date AND ${dateTo}::date
   AND (${itemId}::int IS NULL OR pb.item_id = ${itemId})
 ORDER BY pb.date ASC, pb.id ASC
 LIMIT 5001;
-- totals per item (the overall total is Σ of this result, computed in SQL with GROUPING SETS)
SELECT pb.item_id, i.name, SUM(pb.quantity)::bigint AS quantity, SUM(pb.total_cost)::bigint AS total_cost
  FROM purchase_batches pb JOIN items i ON i.id = pb.item_id
 WHERE <same filters>
 GROUP BY GROUPING SETS ((pb.item_id, i.name), ());
```

Response shape superseded by the §6.9 DTO (Q42): the API sends that DTO, and fields below that it lacks (such as `filters`, `creditLimit`, `headroom`, `totalsByItem`, `totalOwned`) are not sent. Response: `{ generatedAt, filters, rows: [{ batchId, itemId, itemName, date, quantity, unitCost, totalCost }], totalsByItem: [{ itemId, itemName, quantity, totalCost }], totals: { quantity, totalCost }, truncated }`. **No average cost column, anywhere** (client requirement: batches are never averaged).

### 12.4 Report 3 — Activity by period — `GET /api/reports/activity`

Permission `reports.viewActivity`. Query params: `dateFrom`, `dateTo` (required), `customerId?`, `driverId?`, `itemId?`. Filter semantics: `customerId` and `driverId` filter by the order (returns and money rows belong to the order, which carries the driver); `itemId` filters hand-over lines and return lines; when `itemId` is set the payment and refund sections are omitted (`moneyOmitted: true`) because money is recorded per order, not per item.

Common order filter fragment `F(o)`: `o.cancelled_at IS NULL AND (${customerId}::int IS NULL OR o.customer_id = ${customerId}) AND (${driverId}::int IS NULL OR o.driver_id = ${driverId})`.

| Section | Rows query (sorted by date ASC, then created_at ASC) | Row fields | Totals (separate aggregate) |
|---|---|---|---|
| `handOvers` | `order_lines ol JOIN orders o JOIN customers c JOIN drivers d JOIN items i` where `F(o)`, `o.date BETWEEN`, item filter on `ol.item_id` | `orderId, orderNumber, date, customerName, driverName, paymentType, itemId, itemName, quantity, unitDeposit, lineTotal` | per item `{ itemId, itemName, quantity, depositTotal }` and overall `{ quantity, depositTotal }` |
| `returns` | `return_lines rl JOIN returns r (r.reversed_at IS NULL) JOIN order_lines ol JOIN orders o JOIN customers c JOIN items i` where `F(o)`, `r.date BETWEEN`, item filter on `ol.item_id` | `returnId, orderId, orderNumber, date, customerName, itemId, itemName, acceptedQuantity, damagedQuantity, damagedRefund, compensation` where `compensation = rl.damaged_quantity * rl.unit_deposit - rl.damaged_refund` | per item and overall `{ accepted, damaged, damagedRefund, compensationAssessed }` |
| `payments` (omitted when `itemId`) | `ledger_entries le JOIN orders o JOIN customers c` where `F(o)`, `le.type IN ('PAYMENT','PAYMENT_REVERSAL')`, `COALESCE(le.date, o.date) BETWEEN` | `entryId, orderId, orderNumber, date (effective), customerName, type, source, isAutomatic, amount` — reversals are their own rows, never netted | `{ payments: Σ PAYMENT, reversals: Σ PAYMENT_REVERSAL, net: payments − reversals }` |
| `refunds` (omitted when `itemId`) | same with `le.type IN ('REFUND','REFUND_REVERSAL')` | same fields | `{ refunds, reversals, net }` |

Totals SQL pattern (payments):

```sql
SELECT COALESCE(SUM(le.amount) FILTER (WHERE le.type = 'PAYMENT'), 0)::bigint          AS payments,
       COALESCE(SUM(le.amount) FILTER (WHERE le.type = 'PAYMENT_REVERSAL'), 0)::bigint AS reversals
  FROM ledger_entries le JOIN orders o ON o.id = le.order_id
 WHERE o.cancelled_at IS NULL
   AND (${customerId}::int IS NULL OR o.customer_id = ${customerId})
   AND (${driverId}::int IS NULL OR o.driver_id = ${driverId})
   AND le.type IN ('PAYMENT', 'PAYMENT_REVERSAL')
   AND COALESCE(le.date, o.date) BETWEEN ${dateFrom}::date AND ${dateTo}::date;
```

Response shape superseded by the §6.9 DTO (Q42): the API sends that DTO, and fields below that it lacks (such as `filters`, `creditLimit`, `headroom`, `totalsByItem`, `totalOwned`) are not sent. Response: `{ generatedAt, filters, moneyOmitted, handOvers: { rows, totalsByItem, totals, truncated }, returns: { rows, totalsByItem, totals, truncated }, payments?: { rows, totals, truncated }, refunds?: { rows, totals, truncated } }`. The UI labels `compensationAssessed` as "damage compensation assessed" (i18n `reports.activity.compensationAssessed`), never "income", because on LENT orders it may still be inside `owed`.

Worked example: LENT order #7 (2026-09-01, 100 × 1,000), manual payment 40,000 on 2026-09-03, return 50 accepted on 2026-09-05; report 2026-09-01..2026-09-05 → handOvers quantity 100, depositTotal 100,000; returns accepted 50, damaged 0, compensationAssessed 0; payments 40,000 / reversals 0 / net 40,000; refunds 0. The same order CASH instead: payments contains the automatic 100,000 row dated 2026-09-01 and refunds contains the 50,000 cash refund dated 2026-09-05.

### 12.5 Report 4 — Stock levels (snapshot) — `GET /api/reports/stock`

Permission `reports.viewStock`. Query params: `includeArchived?` (default `false`). Contains no cost data.

```sql
WITH out_q AS (
  SELECT ol.item_id, SUM(ol.out_quantity)::bigint AS q
    FROM order_lines ol JOIN orders o ON o.id = ol.order_id
   WHERE o.cancelled_at IS NULL
   GROUP BY ol.item_id
), damaged_q AS (
  SELECT ol.item_id, SUM(rl.damaged_quantity)::bigint AS q
    FROM return_lines rl
    JOIN returns r      ON r.id = rl.return_id AND r.reversed_at IS NULL
    JOIN order_lines ol ON ol.id = rl.order_line_id
    JOIN orders o       ON o.id = ol.order_id AND o.cancelled_at IS NULL
   GROUP BY ol.item_id
)
SELECT i.id, i.name, i.quantity_on_hand, i.min_stock, i.archived_at,
       COALESCE(out_q.q, 0) AS quantity_out, COALESCE(damaged_q.q, 0) AS damaged_total
  FROM items i
  LEFT JOIN out_q     ON out_q.item_id = i.id
  LEFT JOIN damaged_q ON damaged_q.item_id = i.id
 WHERE (${includeArchived} OR i.archived_at IS NULL)
 ORDER BY i.name ASC, i.id ASC;
```

Response shape superseded by the §6.9 DTO (Q42): the API sends that DTO, and fields below that it lacks (such as `filters`, `creditLimit`, `headroom`, `totalsByItem`, `totalOwned`) are not sent. Response: `{ generatedAt, filters, rows: [{ itemId, name, archived, quantityOnHand, quantityOut, totalOwned, damagedTotal, minStock|null, isLowStock }], totals: { quantityOnHand, quantityOut, totalOwned, damagedTotal, lowStockCount } }` with `totalOwned = quantityOnHand + quantityOut` and `isLowStock = minStock !== null && quantityOnHand <= minStock` (never true for archived items). The low-stock flag is shown as a badge with icon **and** text (not colour alone).


## 13. Deployment and operations

### 13.1 Environments

| Environment | Where | Database | How the apps run |
|---|---|---|---|
| Local development | maintainer's machine | `docker-compose.dev.yml` → `postgres:18.6-alpine3.24` on `127.0.0.1:5434`, databases `pallet` and `pallet_test` | `pnpm dev`: shared `tsc -b -w`, API `tsc-watch` → `node dist/main.js` on :3000, Vite on :5175 proxying `/api` → `http://localhost:3000` (same origin) |
| CI | GitHub Actions `ubuntu-24.04` | service container `postgres:18.6-alpine3.24`, roles created by `deploy/postgres/init/01-roles.sh` | built API + `vite preview` for Playwright |
| Production | one Ubuntu 24.04 VPS (2 vCPU, 4 GB RAM, 40 GB disk minimum) | compose service `postgres`, volume `pallet_pgdata` | `docker-compose.yml` (`caddy`, `api`, `postgres`, one-shot `migrate`) |

There is no staging server; the quarterly restore test (§13.7) doubles as a rehearsal on a throw-away VPS.

Local quick start: `corepack enable` → `pnpm install` → create `.env` at the repository root from the LOCAL DEVELOPMENT block of `.env.example` → `pnpm db:up` → `pnpm db:migrate` (applies the migrations and re-applies `grants.sql`, so the runtime role can read its tables) → `pnpm --filter @pallet/api build` → `pnpm db:seed` (first admin + settings) → optionally, with the API stopped, `pnpm db:seed:demo` (two months of demo activity through the domain services, dated day by day; only on a database with no items, customers or orders yet; refused in production) → `pnpm dev` → open `http://localhost:5175`.

### 13.2 Environment variables

Production values live in `/opt/pallet/.env` (mode 600, owner `deploy`); `docker-compose.yml` passes each service only what it needs. Local development uses `.env` at the repository root (read by the API dev script, `apps/api/prisma.config.ts` and the seed). Backup jobs use `/etc/pallet/backup.env` (mode 600, owner root).

| Variable | Used by | Required | Example | Description |
|---|---|---|---|---|
| `APP_VERSION` | compose (image tags), api (`/api/health`, Sentry release) | prod | `3f2c…` (40-hex git SHA) | Deployed commit; managed by `deploy/deploy.sh` |
| `APP_DOMAIN` | caddy | prod | `pallets.example.com` | Public hostname; DNS A/AAAA → VPS |
| `ACME_EMAIL` | caddy | prod | `maintainer@example.com` | Let's Encrypt account email |
| `POSTGRES_PASSWORD` | postgres | prod | 64 hex chars | Superuser `postgres`; never used by the app |
| `DB_OWNER_PASSWORD` | postgres init, migrate | prod | 64 hex chars | Role `pallet_owner` (migrations, seed, backups) |
| `DB_APP_PASSWORD` | postgres init, api | prod | 64 hex chars | Role `pallet_app` (runtime, least privilege) |
| `DATABASE_URL` | api | yes | `postgresql://pallet_app:<pw>@postgres:5432/pallet?schema=public` | Built by compose in prod; set by hand in dev |
| `DATABASE_MIGRATE_URL` | migrate, `prisma.config.ts` | yes (migrate) | `postgresql://pallet_owner:<pw>@postgres:5432/pallet?schema=public` | Owner-role URL for `prisma migrate deploy` / `db execute` / seed |
| `DATABASE_TEST_URL`, `DATABASE_TEST_MIGRATE_URL` | integration tests | dev, CI | `…/pallet_test?schema=public` | App-role and owner-role URLs of the test database |
| `JWT_ACCESS_SECRET` | api | yes | ≥ 64 chars | HS256 key for access tokens |
| `COOKIE_SECURE` | api | yes | `true` (prod), `false` (dev) | `Secure` flag of `pallet_rt` |
| `TRUST_PROXY_SUBNET` | api | yes | `172.28.0.0/24` (prod), `loopback` (dev/CI) | Express `trust proxy` value |
| `API_PORT` | api | no (default `3000`) | `3000` | Listen port |
| `UPLOADS_DIR` | api | yes | `/data/uploads` | Upload storage directory (volume) |
| `NODE_ENV` | api | yes | `production` \| `development` \| `test` | Runtime mode |
| `LOG_LEVEL` | api | no (default `info`) | `info` | pino level |
| `CORS_DEV_ORIGIN` | api | no | empty | Only honoured when `NODE_ENV=development` |
| `SENTRY_DSN` | api | no | empty | Enables `@sentry/nestjs` when non-empty |
| `SENTRY_ENVIRONMENT` | api | no (default `production`) | `production` | Sentry environment tag |
| `ADMIN_USERNAME`, `ADMIN_DISPLAY_NAME`, `ADMIN_PASSWORD` | migrate / `db:seed` | first run | `admin`, `Administrator`, ≥ 10 chars | First admin, created only when `users` is empty; `mustChangePassword = true` |
| `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | backup/restore scripts | prod host | see `deploy/backup/backup.env.example` | Off-site encrypted backups |
| `HEALTHCHECKS_BACKUP_URL`, `HEALTHCHECKS_DISK_URL` | backup / disk-alert scripts | prod host | `https://hc-ping.com/<uuid>` | Dead-man's-switch pings |

`apps/api/src/config/env.ts` validates the API variables with zod at startup (URLs parse, secret length ≥ 64, `COOKIE_SECURE` is `true` whenever `NODE_ENV=production`) and exits with a list of the invalid variable **names** (never values).

### 13.3 Compose topology (`docker-compose.yml`)

| Service | Image | Network address | Published ports | Volumes | User / hardening | Healthcheck | Restart |
|---|---|---|---|---|---|---|---|
| `caddy` | `ghcr.io/mhamad-raad/pallet-caddy:${APP_VERSION}` (built from `deploy/caddy/Dockerfile`: web `dist` baked into `caddy:2.11.4-alpine`) | `172.28.0.10` | `80`, `443`, `443/udp` | `caddy_data:/data`, `caddy_config:/config` | root + `cap_drop: ALL`, `cap_add: NET_BIND_SERVICE`, `read_only` | — (depends on api healthy) | `unless-stopped` |
| `api` | `ghcr.io/mhamad-raad/pallet-api:${APP_VERSION}` (`apps/api/Dockerfile`) | `172.28.0.20` | none | `uploads:/data/uploads` | `node`, `read_only`, tmpfs `/tmp`, `cap_drop: ALL`, `no-new-privileges` | `node dist/scripts/healthcheck.js` every 30 s | `unless-stopped` |
| `migrate` (profile `migrate`) | same as api | dynamic in `172.28.0.128/25` | none | none | as api, `HOME=/tmp` | — | `no` |
| `postgres` | `postgres:18.6-alpine3.24` | `172.28.0.30` | none | `pgdata:/var/lib/postgresql`, `./deploy/postgres/init:/docker-entrypoint-initdb.d:ro` | image default (`postgres`) | `pg_isready -U postgres -d pallet` | `unless-stopped` |

Network `pallet_net`: bridge, subnet `172.28.0.0/24` pinned (Express `trust proxy`), gateway `172.28.0.1`. Named volumes are given fixed names (`pallet_pgdata`, `pallet_uploads`, `pallet_caddy_data`, `pallet_caddy_config`) so scripts can address them. Logging: `json-file`, `max-size 50m`, `max-file 30` on every service. All containers log to stdout/stderr only.

`dist/scripts/migrate.js` (idempotent, exits 0 on success): (1) run `prisma migrate deploy` (child process, `DATABASE_MIGRATE_URL`); (2) run `prisma db execute --file prisma/sql/grants.sql`; (3) seed in one transaction as owner: insert `factory_settings (id 1, factory_name 'Pallet Factory', phone '-', address '-')` if missing (the singleton `order_counter (id 1, last_number 0)` row is inserted by `constraints.sql` inside the migration); if `users` is empty create the admin from `ADMIN_*` (Argon2id hash, `role ADMIN`, `mustChangePassword true`) and write an audit `USER.CREATE` row with `user_id` null. `dist/scripts/healthcheck.js`: `GET http://127.0.0.1:${API_PORT}/api/health`, exit 0 on HTTP 200 within 4 s, else 1. `dist/scripts/reconcile.js`: runs the reconciliation (§14.4 I14), prints `N differences`, exits 1 when N > 0.

### 13.4 First run on a fresh VPS

1. Harden the host (§10.7); install Docker Engine + compose plugin.
2. DNS: A (and AAAA if IPv6) record `APP_DOMAIN` → VPS IP.
3. `sudo git clone https://github.com/Mhamad-Raad/item-lending-management-factory.git /opt/pallet && sudo chown -R deploy:deploy /opt/pallet`.
4. `cp /opt/pallet/.env.example /opt/pallet/.env`; fill every production value (`openssl rand -hex 32` for passwords/secrets); `chmod 600 .env`; store all values in the password manager (§13.6).
5. `docker login ghcr.io -u <github-user>` with a token scoped `read:packages`.
6. Set `APP_VERSION` to the SHA of a successfully built release (Actions → Deploy → images job), `git checkout --detach <sha>`.
7. `docker compose pull && docker compose up -d postgres` (the init script creates roles, `pallet` database).
8. `docker compose --profile migrate run --rm migrate` → migrations, grants, first admin, default settings.
9. `docker compose up -d`; wait for `https://<APP_DOMAIN>/api/health` → 200.
10. Log in as the first admin → forced password change → Settings: factory name (Sorani), phone, address, logo.
11. Backups: `sudo install -d -m 700 /etc/pallet`, create `/etc/pallet/backup.env` from `deploy/backup/backup.env.example`; `restic init`; root crontab: `30 23 * * * /opt/pallet/deploy/backup/backup.sh >> /var/log/pallet-backup.log 2>&1` and `*/15 * * * * /opt/pallet/deploy/backup/disk-alert.sh`; run `backup.sh` once and check the healthchecks.io dashboard.
12. Monitoring: create the uptime check (§13.8).
13. GitHub: repository secrets `VPS_HOST`, `VPS_USER` (`deploy`), `VPS_SSH_KEY` (private key of a key pair dedicated to CI, public half in `~deploy/.ssh/authorized_keys`), `VPS_HOST_FINGERPRINT` (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256`); environment `production` with required reviewer = maintainer.

### 13.5 Deploy and rollback

- CI (`.github/workflows/ci.yml`) on every push to `main` and every PR: jobs `quality` (install `--frozen-lockfile`, lint, format:check, typecheck, unit tests, build), `audit` (`pnpm audit --audit-level=high`), `integration-e2e` (Postgres service, roles script, build, `pnpm db:deploy`, `pnpm test:integration`, Playwright chromium `pnpm test:e2e`, report uploaded on failure), `docker` (both images built, not pushed).
- Deploy (`.github/workflows/deploy.yml`) on tag `v*` or manual dispatch: reuses CI (without the docker job), builds and pushes `pallet-api:<sha>` and `pallet-caddy:<sha>` to GHCR, then (environment `production`) SSHes to the VPS and runs `/opt/pallet/deploy/deploy.sh <sha>`.
- `deploy.sh`: `git checkout --detach <sha>`, set `APP_VERSION`, pull, run `migrate`, `up -d`, wait ≤ 60 s for the API healthcheck; on any failure restore the previous SHA and `up -d` again; on success write `.previous_version` and prune images older than 30 days.
- Migration rule (makes image rollback safe): each release's migrations are **expand-only** (new tables, nullable or defaulted columns, new indexes); dropping or renaming happens in a later release after no deployed code uses the old shape.
- Zero downtime is not required; a deploy restarts `api` and `caddy` (a few seconds).
- All GitHub Actions are pinned to full commit SHAs: `actions/checkout@3d3c42e…` (v7.0.1), `actions/setup-node@8207627…` (v7.0.0), `pnpm/action-setup@ea17c68…` (v6.1.0), `docker/setup-buildx-action@37fe631…` (v4.3.0), `docker/login-action@dbcb813…` (v4.6.0), `docker/build-push-action@53b7df9…` (v7.3.0), `appleboy/ssh-action@0ff4204…` (v1.2.5), `actions/upload-artifact@043fb46…` (v7.0.1).

### 13.6 Backups and key escrow

| Aspect | Setting |
|---|---|
| Schedule | host cron `30 23 * * *` UTC = 02:30 Asia/Baghdad (`deploy/backup/backup.sh`) |
| Content | `pg_dump -U pallet_owner -d pallet -Fc` (custom format) + the `pallet_uploads` volume directory |
| Encryption + transport | `restic` (AES-256-CTR + Poly1305, client-side) to an S3-compatible bucket (Backblaze B2) in a different provider/region from the VPS; bucket application key scoped to that bucket only |
| Retention | `restic forget --keep-daily 30 --prune` (30 days); local dumps kept 3 days in `/var/backups/pallet` (mode 700) |
| Verification | `restic check --read-data-subset=5%` every Sunday; healthchecks.io `start`/success/`fail` pings (alert when no success ping for 26 h); quarterly full restore test |
| RPO / RTO | RPO 24 h; RTO ≈ 2 h (fresh VPS + restore) |

Key escrow — the maintainer's password manager holds, in one entry "Pallet System production": full copy of `/opt/pallet/.env` (`POSTGRES_PASSWORD`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `JWT_ACCESS_SECRET`, `ADMIN_*`, `APP_DOMAIN`, `ACME_EMAIL`, `SENTRY_DSN`), full copy of `/etc/pallet/backup.env` (`RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, bucket key id + secret, healthcheck URLs), the backup provider console login + 2FA recovery codes, the VPS provider login + 2FA recovery codes, the DNS provider login, the GHCR read token, the CI deploy SSH private key. Nothing in this list may exist only on the server. Update the entry before every rotation (`docs/runbooks/rotate-secrets.md`).

### 13.7 Restore and the quarterly restore test

- Restore procedure: `docs/runbooks/restore-from-backup.md` (script `deploy/backup/restore.sh --yes <snapshot>`; drops/recreates `pallet`, `pg_restore`, restores uploads, re-runs `migrate`, starts services, then `reconcile.js` must report 0 differences).
- Quarterly test (January, April, July, October): `docs/runbooks/quarterly-restore-test.md` — a new throw-away VPS rebuilt **only** from the public git repository + the password-manager entry; results table kept in that file.

### 13.8 Monitoring and alerting

| Signal | Tool | Setting | Alert to |
|---|---|---|---|
| Uptime | Better Stack Uptime or UptimeRobot (free tier) | HTTPS GET `https://<APP_DOMAIN>/api/health` every 60 s, expect 200 and body contains `"status":"ok"`; also alerts on TLS certificate expiry < 14 days | maintainer email + phone push |
| Backups | healthchecks.io | check "pallet-backup", period 1 day, grace 2 h | email |
| Disk space | healthchecks.io + `disk-alert.sh` | cron every 15 min; `/fail` when `/`, Docker root or `/var/backups` ≥ 80 %; check "pallet-disk" period 15 min, grace 30 min | email |
| API errors | Sentry free tier or self-hosted GlitchTip via `@sentry/nestjs` | 5xx only, no PII, release = `APP_VERSION` | email |
| Container health | Docker healthchecks + `restart: unless-stopped` | api healthcheck 30 s × 3 retries | (visible via uptime check) |
| Logs | Docker `json-file` | `max-size 50m`, `max-file 30` per service (≈ 30-day retention at this volume); read with `docker compose logs --since 24h api` | — |

No browser-side error reporting (§10.6 D10).

### 13.9 Upgrade path (keep current over years)

| Component | Pinned now | Cadence | Procedure |
|---|---|---|---|
| Node.js | 24.21.0 LTS | patch: monthly via Dependabot docker PRs; major: move to the next even LTS (26) after it becomes Active LTS (October 2026 → plan for 2027 Q1) | `docs/runbooks/upgrade-node-postgres.md` |
| PostgreSQL | 18.6 | minor: when released (image tag bump); major: every 2–3 years via dump/restore, before the running major reaches EOL (PG 18 EOL November 2030) | same runbook |
| Caddy | 2.11.4 | minor/patch via Dependabot | rebuild caddy image |
| NestJS | 11.2.3 | move to 12 when `@nestjs/throttler` and `@sentry/nestjs` declare Nest 12 peers | branch, follow Nest migration guide, full test suite |
| TypeScript | 6.0.3 | move to 7.x when `typescript-eslint` supports it | same |
| Prisma | 7.10.0 | move to 8 after GA and one patch release | read upgrade guide; regenerate; full test suite |
| React / Vite / TanStack / Tailwind / shadcn | see §0 pins | minor monthly via Dependabot; majors deliberately | one major per PR |
| Ubuntu | 24.04 LTS | unattended security upgrades; release upgrade to 26.04 LTS after its first point release | fresh VPS + restore (preferred over in-place upgrade) |

### 13.10 Runbook index (`docs/runbooks/`)

| File | Purpose |
|---|---|
| `deploy.md` | Deploy a new version (automatic via tag; manual fallback) |
| `rollback.md` | Roll back to the previous version; when a restore is needed instead |
| `restore-from-backup.md` | Restore database + uploads from restic |
| `rotate-secrets.md` | Rotate JWT secret, DB passwords, backup key, bucket keys, SSH/GHCR credentials |
| `manage-users.md` | Add / deactivate a user, reset a password, log a user out everywhere |
| `unlock-account.md` | Clear an (IP, username) lockout |
| `last-admin-recovery.md` | Direct-DB procedure when no admin can log in |
| `upgrade-node-postgres.md` | Upgrade Node.js, PostgreSQL (minor/major) and pinned major libraries |
| `quarterly-restore-test.md` | "Fresh VPS from off-site material only" checklist + results log |

### 13.11 Known limitations

- **No offline operation.** When the factory's internet connection (or the VPS) is down, the system is unavailable; staff record hand-overs on paper and enter them afterwards with the correct business date (back-dating is allowed; future dates are not).
- Single VPS: a host failure means restore from the last nightly backup (RPO 24 h, RTO ≈ 2 h).
- Rate-limit counters are in memory and reset on API restart (the persistent (IP, username) lockout lives in the database and survives).
- Deploys cause a few seconds of downtime.


## 14. Testing plan

### 14.1 Layers, tools and locations

| Layer | Tool | Location | Runs against | Command |
|---|---|---|---|---|
| Unit (shared) | vitest 5.0.0 | `packages/shared/src/**/*.test.ts` | pure functions | `pnpm test` |
| Unit (API) | vitest + `unplugin-swc` (decorator metadata) | `apps/api/src/**/*.test.ts` | services with Prisma mocked by in-memory fakes, pure helpers | `pnpm test` |
| Unit (web) | vitest + jsdom 30 + @testing-library/react 16 | `apps/web/src/**/*.test.ts(x)` | components, hooks, i18n files | `pnpm test` |
| Integration (API) | vitest + supertest 7 + real PostgreSQL | `apps/api/test/integration/**/*.test.ts`, config `apps/api/vitest.integration.config.mts` (`fileParallelism: false`) | Nest app booted in-process (`Test.createTestingModule(AppModule)`), connected as **`pallet_app`** to `pallet_test` | `pnpm test:integration` |
| End-to-end | @playwright/test 1.63 (chromium) | `apps/web/e2e/*.spec.ts`, config `apps/web/playwright.config.ts` | built API (`node dist/main.js`, `pallet_test` DB seeded with `db:seed:demo`) + `vite preview` with `/api` proxy | `pnpm test:e2e` |

Integration harness (`apps/api/test/helpers/`): `resetDatabase()` runs, as `pallet_owner` via `DATABASE_TEST_MIGRATE_URL`, `TRUNCATE` of every table `RESTART IDENTITY CASCADE` (the owner role is allowed; the triggers `forbid_update_delete` fire on `UPDATE`/`DELETE`, not `TRUNCATE`), then inserts `order_counter`, `factory_settings` and one admin. `migrate` runs once per test run (`globalSetup`: `prisma migrate deploy` + `grants.sql` against `pallet_test`). Factories: `createEmployee(permissions[])`, `loginAs(user)` → `{ accessToken, cookie }`, `createItem({ depositPrice, stock })`, `createCustomer({ creditLimit })`, `createDriver()`, `createOrder(...)`. Time is controlled through the injectable `Clock` (`apps/api/src/common/clock.ts`, `now(): Date`); tests override it with `FixedClock`. Every request helper sends `X-Requested-With: pallet-web` unless the test is about CSRF.

Coverage gates (vitest `coverage.thresholds`): `packages/shared/src/domain/**` 100 % lines and branches; `apps/api/src/modules/{orders,returns,ledger,purchases,items,auth}/**` 85 % lines (unit + integration combined in CI).

### 14.2 Unit tests (required cases)

| ID | Subject | Cases |
|---|---|---|
| U1 | `computeOrderTotals` + `returnMoney` — the nine worked examples of §4 | table below, each asserting every listed value |
| U2 | Return edit | CASH 100 × 1,000; return A 50 accepted → REFUND 50,000; edit A to 40 accepted: A reversed + REFUND_REVERSAL 50,000 → owedBefore of B = 0; B refundDue 40,000 → cashRefund 40,000; final: depositTotal 100,000, payments 100,000, credits 40,000, refundsNet 40,000, owed 0, outQuantity 60, outValue 60,000, held 60,000, OPEN |
| U3 | Cancel | CASH 100 × 1,000 with automatic payment 100,000 and its PAYMENT_REVERSAL 100,000, `cancelled: true` → owed 0, outValue 0, held 0, compensation 0, every line outQuantity 0, status CANCELLED |
| U4 | `checkCreditLimit` | limit null, delta 5,000,000 → allowed; limit 0, delta 0 → allowed; limit 0, delta 1,000 → blocked, excess 1,000; limit 150,000, out 100,000, delta 60,000 → blocked, excess 10,000; limit 150,000, out 100,000, delta 50,000 → allowed (equality); out 200,000 (already over), delta −20,000 → allowed |
| U5 | `chunkReceiptLines` | 0 lines → 1 chunk of 0; 6 → [6]; 7 → [6, 1]; 12 → [6, 6]; 13 → [6, 6, 1] |
| U6 | permissions | `closePermissionSet(['reports.viewPurchases'])` = {reports.viewPurchases, items.viewCost, items.view}; `missingPermissionDependencies(['orders.create'])` = [customers.view, drivers.view, items.view, orders.view]; every key in `PERMISSION_DEPENDENCIES` is grantable; no admin-only key is grantable |
| U7 | enum parity | parse `apps/api/prisma/schema.prisma` enums and assert equality with `packages/shared/src/enums.ts` arrays |
| U8 | error codes | every `ERROR_CODES` value is 400–503; no duplicates |
| U9 | shared zod schemas | strict objects reject unknown keys; money > `MONEY_INPUT_MAX` rejected; quantity 0 rejected; `date` must match `YYYY-MM-DD` and be a real calendar day (`2026-02-30` rejected) |
| U10 | audit snapshots | USER snapshot never contains `passwordHash`/`tokenVersion`; recursive `/password|token|secret/i` stripping; read redaction removes `unitCost`, `totalCost`, `initialBatch.unitCost`, `initialBatch.totalCost` only when `canViewCost = false` |
| U11 | idempotency hash | canonical JSON is key-order independent (`{a:1,b:2}` ≡ `{b:2,a:1}`), array order significant; hash includes method + path |
| U12 | phone normalization | `"0750 123-4567"` → `07501234567`; `"+964 (750) 1234567"` → `+9647501234567`; `"12ab"` rejected |
| U13 | Baghdad dates | `todayInBaghdad(new Date('2026-09-11T20:59:59Z'))` = `2026-09-11`; `…T21:00:00Z` = `2026-09-12` |
| U14 | lockout backoff | successive lockouts give 1, 2, 4, 8, 15, 15 minutes |
| U15 | permission declarations | booting `AppModule` succeeds; a test controller without a declaration makes bootstrap throw |
| U16 | i18n completeness (web) | §14.5 |

U1 expected values (`O` = OPEN, `S` = SETTLED):

| # | Setup | refundDue | owedBefore | cashRefund | owed after | outValue | held | compensation | status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | CASH 100 × 1,000; return 100 acc | 100,000 | 0 | 100,000 | 0 | 0 | 0 | 0 | S |
| 2 | CASH; 90 acc + 10 dmg (refund 0) | 90,000 | 0 | 90,000 | 0 | 0 | 0 | 10,000 | S |
| 3 | LENT; 90 acc + 10 dmg (refund 0) | 90,000 | 100,000 | 0 | 10,000 | 0 | 0 | 10,000 | O |
| 4 | LENT; 0 acc + 50 dmg (refund 0) | 0 | 100,000 | 0 | 100,000 | 50,000 | 0 | 50,000 | O |
| 5 | LENT; pay 40,000; 50 acc | 50,000 | 60,000 | 0 | 10,000 | 50,000 | 40,000 | 0 | O |
| 6 | (5) then 50 acc | 50,000 | 10,000 | 40,000 | 0 | 0 | 0 | 0 | S |
| 7 | CASH 100; line edited to 60 (auto payment 100,000 reversed, new 60,000) | — | — | — | 0 (depositTotal 60,000, payments 60,000) | 60,000 | 60,000 | 0 | O |
| 8 | CASH 100; return 50 acc (REFUND 50,000) then deleted (REFUND_REVERSAL 50,000) | — | — | — | 0 | 100,000 | 100,000 | 0 | O |
| 9 | any order cancelled | — | — | — | 0 | 0 | 0 | 0 | CANCELLED |

### 14.3 Integration tests — business flows (required cases)

| ID | Case | Assertions |
|---|---|---|
| I1 | Worked examples 1–9 end-to-end over HTTP | response DTO values = U1 table; ledger rows (type, source, amount, `is_automatic`, `date` null only on automatic PAYMENT); stock movements (reason, signed quantity) and `items.quantity_on_hand`; `orders.status` |
| I2 | Return edit (U2 scenario) | old return `reversed_at` set, `reversal_kind = 'EDIT'`, `replaced_by_return_id` = new id; movements RETURN_ACCEPTED +40 then RETURN_EDIT −50 (Q48); ledger REFUND_REVERSAL 50,000 (source RETURN_EDIT) + REFUND 40,000 (source RETURN_EDIT); audit RETURN_EDIT + REFUND_REVERSE + REFUND_CREATE |
| I3 | Return delete (example 8) | RETURN_DELETE −50; REFUND_REVERSAL (source RETURN_DELETE); second delete → 409 `RETURN_ALREADY_REVERSED` |
| I4 | Cancel | ORDER_CANCEL movements restore stock; PAYMENT_REVERSAL (source ORDER_CANCEL) on CASH; order keeps its number, status CANCELLED; customer aggregates exclude it; cancel with a non-reversed return or manual payment → 409 `ORDER_HAS_ACTIVITY`; after that payment is reversed, cancel succeeds |
| I5 | Line edit | CASH re-issue (example 7) with ORDER_LINE_EDIT movement +40; LENT edit leaves the ledger untouched; adding/removing lines; `unitDeposit` supplied by an employee without `orders.editUnitDeposit` → 403 `UNIT_DEPOSIT_NOT_PERMITTED`; with the permission → stored |
| I6 | Stock checks | order quantity > on-hand → 409 `STOCK_INSUFFICIENT` with `details.items`; batch delete making stock negative → 409; manual adjustment below zero → 409; DB CHECK backstop verified by a raw update attempt as owner |
| I7 | Credit limit | employee blocked → 409 `CREDIT_LIMIT_EXCEEDED` `details { creditLimit, customerOutValue, depositDelta, excess, canOverride: false }`; admin without confirmation → same with `canOverride: true`; admin with `confirmCreditOverride: true` → 201, `credit_override_by_user_id` set, audit CREDIT_OVERRIDE; employee sending `confirmCreditOverride: true` → 403 `ADMIN_ONLY`; line edit with positive delta re-checks, negative delta never blocked |
| I8 | Concurrency (locks) | limit 100,000, two parallel `POST /api/orders` of 60,000 each (different idempotency keys) → exactly one 201 and one 409; stock 10, two parallel orders of 7 → one 201, one 409; parallel return + payment on one order keep `owed ≥ 0`; no deadlock across 20 parallel mixed creates (all complete within the 15 s transaction timeout) |
| I9 | Order numbers | a failed create (credit limit) consumes no number; 20 parallel creates yield exactly 1..20 |
| I10 | Idempotency | replay with same body → identical status/body + header `Idempotency-Replayed: true`, no new rows; same key different body → 409 `IDEMPOTENCY_KEY_REUSED`; missing header → 400 `IDEMPOTENCY_KEY_REQUIRED`; malformed → 400 `IDEMPOTENCY_KEY_INVALID`; blocked credit attempt stores nothing, then admin re-submit with the same key and `confirmCreditOverride` → 201; key older than 24 h (clock advanced) is treated as new; same key used by two different users → independent |
| I11 | Optimistic locking | PATCH with stale `version` → 409 `VERSION_CONFLICT` `details.currentVersion`; success increments version by 1 (items, customers, drivers, batches, orders, users, settings) |
| I12 | Payments | payment > owed → 409 `PAYMENT_EXCEEDS_OWED`; payment on CASH order → 409 `PAYMENT_ORDER_NOT_LENT`; date before order date → 400; reverse manual payment → PAYMENT_REVERSAL (source PAYMENT_DELETE); reversing an automatic payment → 409 `LEDGER_ENTRY_NOT_REVERSIBLE` |
| I13 | Returns validation | exceeding out quantity → 409 `RETURN_EXCEEDS_OUT`; `damagedRefund > damaged × unitDeposit` → 400 `DAMAGED_REFUND_TOO_HIGH`; all-zero → 400 `RETURN_EMPTY`; line of another order → 400 `RETURN_LINE_NOT_IN_ORDER`; return on cancelled order → 409 `ORDER_CANCELLED` |
| I14 | Ledger reconciliation | after a scripted sequence (seeded pseudo-random, seed 20260911) of 200 operations across all endpoints, `reconcile()` reports 0 differences: for every order the maintained columns equal `computeOrderTotals` of its rows; for every item `quantity_on_hand = Σ stock_movements.quantity`; for every return `refund_due` = recomputed value |
| I15 | Archive rules | archived item/customer/driver rejected on new orders; customer with an OPEN order cannot be archived (409 `CUSTOMER_HAS_OPEN_ORDERS`); archived rows still render in existing orders |
| I16 | Duplicate phone | create with an existing phone → 409 `CUSTOMER_PHONE_DUPLICATE` `details.matches`; resubmit with `confirmDuplicatePhone: true` → 201 |

### 14.4 Integration tests — security behaviours (required cases)

| ID | Case | Assertions |
|---|---|---|
| S-1 | Generic login error | wrong username, wrong password, locked pair, inactive user → identical status 401 and identical body except `requestId`; `argon2.verify` spy called exactly once per attempt in all four cases |
| S-2 | Lockout per (IP, username) | 5 failures from `X-Forwarded-For: 203.0.113.1` (test sets `TRUST_PROXY_SUBNET=loopback`) → 6th attempt with the **correct** password rejected; same username from `203.0.113.2` logs in; other username from `203.0.113.1` logs in; `LOCKOUT` audited with IP; backoff doubling with the clock advanced; success deletes the row |
| S-3 | Per-IP login cap | 61st login request within 60 s from one IP → 429 `RATE_LIMITED` with `Retry-After` |
| S-4 | Refresh rotation | refresh returns a new cookie; old token row `ROTATED`; exactly one ACTIVE token per family |
| S-5 | Grace window | present token P, then P again 10 s later (FixedClock) → second call 200 with a new cookie; the token issued by the first call becomes `RETIRED`; family not revoked; no `SESSION_REUSE_DETECTED` |
| S-6 | Post-window revocation | present P, then P again 31 s later → 401 `AUTH_REFRESH_INVALID`, family `revoked_reason = 'REUSE_DETECTED'`, all tokens `REVOKED`, audit row written, the latest token also fails |
| S-7 | Older token | rotate P → Q → R normally (each > 30 s apart), then present P → family revoked |
| S-8 | Expiry | token older than 14 days (sliding) → 401; family older than 30 days even with fresh rotations → 401 |
| S-9 | Logout / logout-all | logout revokes only that family; logout-all revokes all families and bumps `token_version` → an access token issued before is rejected (`AUTH_TOKEN_INVALID`) |
| S-10 | Deactivation / password reset / change | existing access token rejected on the next request; refresh fails; change-own-password returns a working new access token + cookie in the same response |
| S-11 | Live permission change | grant `orders.view` to a logged-in employee → the next request with the same access token succeeds (no re-login); revoke → next request 403 |
| S-12 | Permission denial per key | table-driven over the full endpoint catalogue (§6): employee with no permissions → 403 `PERMISSION_DENIED` on every non-public, non-`@Authenticated` route; employee holding exactly the declared key(s) (plus dependencies) → not 403 |
| S-13 | Admin-only | employee holding every grantable key → 403 `ADMIN_ONLY` on every `/api/users` route, `PUT /api/settings`, `FACTORY_LOGO` upload, credit override |
| S-14 | Cost-field stripping | employee with `purchases.view` without `items.viewCost`: `GET /api/purchase-batches`, `GET /api/items/:id` batches, `GET /api/audit-logs` (with `audit.view`) contain no `unitCost`/`totalCost` keys anywhere in the body (recursive key search); `GET /api/reports/purchases` → 403; admin sees them |
| S-15 | Guards | self-deactivate → 409 `SELF_DEACTIVATE_FORBIDDEN`; self-demote → 409 `SELF_DEMOTE_FORBIDDEN`; deactivating or demoting the last active admin → 409 `LAST_ADMIN_GUARD` (also when two admins try concurrently to demote each other: exactly one succeeds) |
| S-16 | Must change password | new user: every route except the allow-list → 403 `PASSWORD_CHANGE_REQUIRED`; after change → allowed |
| S-17 | CSRF header | POST/PUT/PATCH/DELETE without `X-Requested-With: pallet-web` → 403 `CSRF_HEADER_MISSING` (also on `/api/auth/login`); GET unaffected |
| S-18 | DB privileges | using the `pallet_app` connection: `UPDATE audit_logs …`, `DELETE FROM audit_logs …`, `UPDATE ledger_entries …`, `DELETE FROM stock_movements …`, `UPDATE return_lines …`, `UPDATE returns SET refund_due = 0 …` → SQLSTATE `42501`; `UPDATE returns SET reversed_at = now() …` on a non-reversed return succeeds once and a second time raises the trigger error |
| S-19 | Uploads | text file renamed `.png` → 415; 6 MB image → 413; PNG → stored as `.webp`, served with `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, EXIF absent (`sharp(buf).metadata().exif` undefined); 11th upload by one user in 60 s → 429; path traversal `GET /api/uploads/..%2f.env` → 404 |
| S-20 | Strict validation | unknown body key → 400 `VALIDATION_FAILED` with field code `unknown_key` |
| S-21 | Log redaction | captured pino output of a login contains neither the password nor the `Set-Cookie` value |

### 14.5 i18n completeness (web unit test `apps/web/src/i18n/locales.test.ts`)

1. `ckb.json`, `ar.json`, `en.json` have identical flattened key sets.
2. Keys exist for every `ErrorCode` (`errors.<CODE>`), every `ValidationCode` (`validation.<code>`), every enum value (`enums.<enumName>.<VALUE>`), every permission key (`permissions.<key with "." → "_">`), every audit summary key of §11.3.
3. No empty values; no `ckb`/`ar` value contains a Latin letter `[A-Za-z]` except keys in `LATIN_ALLOWLIST` (`common.currencyCode`, `common.appName`).
4. Interpolation placeholders (`{{name}}`) are identical across the three languages for each key.

### 14.6 End-to-end (Playwright, chromium, `locale: 'ckb'` preferences pre-set via `boot-prefs`)

| ID | Flow | Assertions |
|---|---|---|
| E1 | Login + forced password change | new user lands on `/change-password`, then dashboard |
| E2 | Create order (daily flow 1) in `ckb` | `<html dir="rtl" lang="ckb">`; searchable customer/driver/item selects; live deposit total updates while typing; submit → order page with number; stock decreased on item page |
| E3 | Record return (daily flow 2) | from dashboard quick action; refund due, cash refund and owed-after update live; submit → order shows returned quantities |
| E4 | Record payment (daily flow 3) | LENT order; amount > owed shows inline error; valid payment updates owed |
| E5 | Receipt print route | `page.emulateMedia({ media: 'print' })`; 2 copies per sheet separated by the dashed cut line; Sorani labels; Western digits; `dd/MM/yyyy` date; an order with 7 lines renders 2 sheets, "sheet 1 of 2", total only on sheet 2; `page.pdf({ format: 'A4' })` produces exactly 2 pages |
| E6 | RTL screenshots | `expect(page).toHaveScreenshot()` of E2–E4 final forms in `ckb` at 1280 × 800 and 390 × 844, `maxDiffPixelRatio: 0.01`; baselines committed under `apps/web/e2e/__screenshots__/` (generated on the CI runner image) |
| E7 | Language + theme switch | switching to `en` flips `dir` to `ltr` without reload; dark theme toggles `html.dark`; receipt stays light |
| E8 | Permission-hidden UI | employee without `orders.cancel` sees no Cancel button |

Every e2e test uses the seeded demo data (`db:seed:demo`, deterministic seed) and resets the database before the suite.


## 15. Phased build order

Rules for every milestone: work on a branch, keep `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration` green, and finish with something runnable locally (`pnpm db:up && pnpm db:migrate && pnpm dev`). A milestone is done only when every box in its acceptance checklist is ticked. Every new endpoint carries its permission decorator, zod schema from `@pallet/shared`, error codes from `ERROR_CODES`, audit rows (§11.3), and translations in all three locale files, from the milestone that introduces it (i18n/RTL are polished in M6, not added then).

### M0 — Baseline (already delivered in the repository)

- pnpm workspace (`apps/web`, `apps/api`, `packages/shared`), exact version pins, TypeScript 6.0 strict, ESLint 10 flat config, Prettier, Husky + lint-staged, `.editorconfig`, `.nvmrc`.
- Prisma 7 schema (`apps/api/prisma/schema.prisma`), initial migration (DDL + `constraints.sql`: CHECK constraints, partial unique index, triggers), `prisma/sql/grants.sql`, role init script `deploy/postgres/init/01-roles.sh`.
- `@pallet/shared`: `enums.ts`, `permissions.ts`, `error-codes.ts`, `dates.ts`, `domain/ledger-math.ts` with tests for all nine worked examples, `schemas/common.ts`.
- API shell: env validation, `PrismaService` (PrismaPg adapter), nestjs-pino with request ids, `ApiExceptionFilter`, access decorators, `GET /api/health`, scripts `migrate`, `seed`, `healthcheck`, `reconcile`.
- Web shell: Vite 8, TanStack Router, `boot-prefs.js`, i18next with `ckb`/`ar`/`en` files and the parity test, Tailwind tokens (light/dark), shadcn `Button`.
- Playwright smoke test; compose files, Caddy, Dockerfiles, CI/deploy workflows, backup scripts, runbooks.

Acceptance (verify before starting M1): `pnpm install && pnpm build && pnpm test` pass; `pnpm db:up && pnpm db:migrate` applies cleanly; `GET http://localhost:3000/api/health` → 200; web shell renders RTL in `ckb`.

### M1 — Auth, users, permissions, audit log (continues from M0)

1. `Clock`, `RequestContext`, `AuditService.record` + `toAuditSnapshot` + redaction (§11).
2. Guards in order: `AppThrottlerGuard` → `CsrfGuard` → `AuthGuard` (JWT strategy, per-request user load) → `PasswordChangeGuard` → `PermissionGuard`; `PermissionDeclarationCheck` (fails startup on an undeclared route).
3. Password service (Argon2id, dummy hash, common-password list), login-throttle service, session service (families, rotation, grace window, reuse detection), `MaintenanceService` (§6.8.2: login throttles purged hourly, expired session families daily; the idempotency purge joins it in M3).
4. Endpoints: `/api/auth/login|refresh|logout|logout-all|me|change-password`; `/api/users` (list, create, get, patch, permissions, reset-password, logout-all) with self/last-admin guards; `GET /api/audit-logs`.
5. Web: API client (in-memory token, `X-Requested-With`, refresh-once-and-retry, Web Locks + BroadcastChannel), `/login`, `/change-password`, authenticated `_app` shell (sidebar/bottom nav filtered by permissions), `/users`, `/users/new`, `/users/$userId` (permission checklist with dependency auto-tick), `/account`, `/history`.

Acceptance: U6, U10, U14, U15; integration S-1 … S-18, S-20, S-21; first admin logs in, is forced to change password, creates an employee, grants/revokes permissions (effective on next request), and every action appears on `/history`.

### M2 — Items, batches, stock ledger, customers, drivers, uploads, settings

1. Uploads module (`POST /api/uploads`, `GET /api/uploads/:fileName`, sharp pipeline, per-user rate limit).
2. Settings (`GET`/`PUT /api/settings`, logo upload).
3. Items (CRUD-as-archive, `initialBatch`, stock adjustments, stock-movement list, derived `quantityOut`/`damagedTotal`/`isLowStock`), purchase batches (CRUD with soft delete and BATCH_* movements, cost stripping), shared `applyStockMovements(tx, movements[])` helper (per-item net, non-negative check, one UPDATE per item).
4. Customers (phone normalization, duplicate warning flow, phone-check endpoint, archive rule), drivers.
5. Web pages: `/items*`, `/customers*` (profile summary shows zeros until M3/M4), `/drivers` with dialog, `/settings`; shared `DataTable` (search, sort, pagination, sticky header, card layout below `md`, §7.5), `ImageUploadField`, `MoneyInput`, `QuantityInput`, searchable selects.

Acceptance: U9, U12; I6 (stock parts), I11, I15, I16, S-14, S-19; item with initial batch shows on-hand stock; employee without `items.viewCost` never sees cost anywhere (UI and API); reconciliation reports 0 differences for items.

### M3 — Orders, credit limit, receipt

1. Locks helper (`locks.ts`: customer → order → items sorted → counter), `recomputeOrder(tx, orderId)`, idempotency service.
2. `POST /api/orders` (steps 1–7 of the order flow), `GET` list/detail, `PATCH` (header + line edit with CASH re-issue), `POST /cancel`, `GET /receipt`, `GET /api/ledger-entries` (automatic payments so far).
3. Credit-limit check with admin override confirmation dialog.
4. Web: `/orders`, `/orders/new` (one-screen form, live totals, credit-limit dialog), `/orders/$orderId`, `/orders/$orderId/edit`, `/print/orders/$orderId` (two stacked copies, cut line, 6 lines per half, "sheet X of Y", total on last sheet, Sorani only, Western digits).

Acceptance: U4, U5, U11; I1 examples 7 and 9, I4 (cancel without activity), I5, I7, I8, I9, I10; receipt prints correctly from Chrome, Firefox, Edge and Safari on desktop (manual check).

### M4 — Returns, money ledger, payments, refunds

1. `POST /api/orders/:orderId/returns` (owedBefore from the locked order, cashRefund, REFUND row, RETURN_ACCEPTED movements), `POST /api/returns/:id/replace`, `DELETE /api/returns/:id`.
2. `POST /api/orders/:orderId/payments`, `POST /api/ledger-entries/:id/reverse`.
3. Order edit/cancel gates now consider non-reversed returns and manual payments.
4. Customer profile: holdings, history timeline, orders/payments/refunds lists.
5. Web: `/returns/new` and `/payments/new` one-screen flows with live refund due / cash refund / owed-after; returns and money sections on the order page; reverse/edit return dialogs.

Acceptance: U1 (all), U2, U3; I1 (all nine), I2, I3, I4 (with activity), I12, I13, I14 (reconciliation over 200 scripted operations → 0 differences).

### M5 — Reports and dashboard

1. `GET /api/reports/positions|purchases|activity|stock` (§12), `GET /api/dashboard` (sections gated per permission).
2. Web: `/reports/*` with filters, totals, print CSS; `/` dashboard with large summary cards (count-up), quick actions (New order, Record return, Record payment), recent activity list, low-stock card.

Acceptance: report totals match hand-computed fixtures (seeded scenario of §12.4 worked example); cancelled orders and reversed returns never appear in any aggregate; purchases report 403 without `items.viewCost`; each report prints on A4 with repeating table headers.

### M6 — i18n / RTL / themes / font size polish + motion

1. Complete and review `ckb`, `ar`, `en` files (§14.5 passes; native-speaker proofreading of `ckb` and `ar` recorded as done by the client).
2. RTL audit of every generated shadcn component (§7 list): replace `left/right` with `start/end`, derive `side`/`align` from direction, flip directional icons (`rtl:-scale-x-100`), sonner `top-center`.
3. Theme (light/dark), font-size steps, `prefers-reduced-motion`, motion rules (§7), skeleton loaders, empty states, keyboard (Enter submits, Esc closes, focus trap), visible focus rings, WCAG AA contrast check in both themes (axe via Playwright: 0 serious/critical violations on the three daily flows).

Acceptance: U16; E6 screenshot baselines approved; E7; every screen usable at 390 px.

### M7 — Security hardening, deployment, backups, e2e

1. Re-run §10 checklist line by line; `pnpm audit` clean; Dependabot enabled.
2. Provision the VPS (§10.7, §13.4), first deploy through `deploy.yml`, backups + disk alert cron, uptime monitor, Sentry DSN.
3. Full e2e suite E1–E8 green in CI; first quarterly restore test performed and recorded.

Acceptance: `https://<APP_DOMAIN>` serves the app with the exact security headers (verify with `curl -sI`); only ports 22/80/443 reachable from outside (`nmap` from another host); a restore onto a fresh VPS from off-site material succeeds; runbooks walked through once by the maintainer.


## 16. Suggested future improvements (out of scope — do NOT build)

Nothing in this section is part of the specification above; none of it may be implemented without a new agreement with the client. Each item notes the design hook that already makes it cheap later.

| # | Improvement | Why the client may ask | Design hook already present |
|---|---|---|---|
| F1 | Overdue-pallet reminders (pallets out longer than N days) | chase customers holding pallets too long | `order_lines.out_quantity` + `orders.date`; a report query and a dashboard card |
| F2 | Printable customer statement | send a customer their position and history | customer history endpoint + print route pattern of the receipt |
| F3 | Return / refund slip | paper proof for the driver at return time | returns store `refund_due`, `owed_before`, `cash_refund` |
| F4 | Deferred refund payout ("refund due, pay later") | factory cannot always pay cash at return | would need a new ledger row type and an owed-to-customer balance; today a return asserts immediate payout (A4) |
| F5 | CSV / Excel export of reports | accountant wants spreadsheets | report endpoints already return flat row arrays |
| F6 | Customer-level payments allocated across orders | customers pay one lump sum | payments are per order today (A7); needs an allocation table |
| F7 | Two-factor authentication for admins | stronger admin accounts | per-request user load makes enforcement a guard |
| F8 | Unarchive items / customers / drivers | recover an accidental delete | `archived_at` soft delete; restore = set it to NULL + audit row |
| F9 | Admin UI to clear a login lockout | avoid the SQL runbook | `login_throttles` table keyed (ip, username) |
| F10 | Multiple locations / warehouses | growth | would add `location_id` to items stock and movements |
| F11 | Offline capture | internet outages at the factory | out of scope by decision (§13.11) |


