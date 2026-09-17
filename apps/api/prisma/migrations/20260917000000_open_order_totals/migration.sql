-- Q62: totals over years of history read only what is still standing.
--
-- A SETTLED order has nothing out and owes nothing (§4.3: status is OPEN exactly while pallets are
-- out or money is owed), so its out value and held are zero too. The customer list, the positions
-- report, the dashboard and the credit check sum those columns; they now sum OPEN orders only, and
-- this CHECK makes the equivalence the database's, not an assumption of the queries.
ALTER TABLE orders
  ADD CONSTRAINT orders_settled_nothing_standing_check CHECK (
    status <> 'SETTLED' OR (out_quantity_total = 0 AND owed = 0 AND out_value = 0 AND held = 0)
  );

-- Customer and factory totals over open orders (index-only).
CREATE INDEX orders_open_totals_idx
  ON orders (customer_id) INCLUDE (out_quantity_total, out_value, owed, held)
  WHERE status = 'OPEN';

-- Compensation stays assessed after settlement: summed over the orders that have any.
CREATE INDEX orders_compensation_idx
  ON orders (customer_id) INCLUDE (compensation)
  WHERE compensation > 0;

-- Items' pallets out and damaged totals, from the maintained line columns.
CREATE INDEX order_lines_outstanding_idx
  ON order_lines (item_id) INCLUDE (out_quantity, order_id)
  WHERE out_quantity > 0;

CREATE INDEX order_lines_damaged_idx
  ON order_lines (item_id) INCLUDE (returned_damaged, order_id)
  WHERE returned_damaged > 0;

-- The dashboard's recent activity: the newest of each kind of event.
CREATE INDEX orders_cancelled_at_id_idx ON orders (cancelled_at, id) WHERE cancelled_at IS NOT NULL;
CREATE INDEX ledger_entries_manual_payments_created_at_id_idx
  ON ledger_entries (created_at, id) WHERE type = 'PAYMENT' AND source = 'MANUAL';
CREATE INDEX ledger_entries_refunds_created_at_id_idx
  ON ledger_entries (created_at, id) WHERE type = 'REFUND';

-- Plain indexes, declared in schema.prisma.
CREATE INDEX "orders_created_at_id_idx" ON "orders"("created_at", "id");
CREATE INDEX "returns_created_at_id_idx" ON "returns"("created_at", "id");
CREATE INDEX "stock_movements_item_id_id_idx" ON "stock_movements"("item_id", "id");
