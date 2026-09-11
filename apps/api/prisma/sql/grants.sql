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
