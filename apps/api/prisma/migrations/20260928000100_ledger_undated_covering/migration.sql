-- Q99: the automatic payments' partial index carries the columns the activity report's money totals and
-- pages read, so a month's automatic payments are found by probing it per order, index-only (4 ms),
-- instead of the planner reading all of them from the table to hash them against the month (30 ms).
DROP INDEX ledger_entries_undated_order_id_idx;
CREATE INDEX ledger_entries_undated_order_id_idx
  ON ledger_entries (order_id) INCLUDE (amount, created_at, type) WHERE date IS NULL;
