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
  ADD CONSTRAINT orders_version_positive_check CHECK (version >= 1),
  -- Q62 (migration 20260917000000_open_order_totals): a settled order has nothing standing, so totals
  -- of what is out, owed or held are read from open orders only.
  ADD CONSTRAINT orders_settled_nothing_standing_check CHECK (
    status <> 'SETTLED' OR (out_quantity_total = 0 AND owed = 0 AND out_value = 0 AND held = 0)
  );

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
-- Partial and covering indexes (Q62, migration 20260917000000_open_order_totals)
-- Totals over years of history read only what is still standing; the dashboard reads the newest events.
-- ═══════════════════════════════════════════════════════════════════════════════════════
CREATE INDEX orders_open_totals_idx
  ON orders (customer_id) INCLUDE (out_quantity_total, out_value, owed, held)
  WHERE status = 'OPEN';
CREATE INDEX orders_compensation_idx
  ON orders (customer_id) INCLUDE (compensation)
  WHERE compensation > 0;
CREATE INDEX order_lines_outstanding_idx
  ON order_lines (item_id) INCLUDE (out_quantity, order_id)
  WHERE out_quantity > 0;
CREATE INDEX order_lines_damaged_idx
  ON order_lines (item_id) INCLUDE (returned_damaged, order_id)
  WHERE returned_damaged > 0;
CREATE INDEX orders_cancelled_at_id_idx ON orders (cancelled_at, id) WHERE cancelled_at IS NOT NULL;
CREATE INDEX ledger_entries_manual_payments_created_at_id_idx
  ON ledger_entries (created_at, id) WHERE type = 'PAYMENT' AND source = 'MANUAL';
CREATE INDEX ledger_entries_refunds_created_at_id_idx
  ON ledger_entries (created_at, id) WHERE type = 'REFUND';

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Seed rows required by the schema itself
-- ═══════════════════════════════════════════════════════════════════════════════════════
INSERT INTO order_counter (id, last_number) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
