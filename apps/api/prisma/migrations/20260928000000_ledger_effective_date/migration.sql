-- Q98: the money ledger filtered and sorted by effective date without reading all of it.
--
-- A row's effective date is its own date, or its order's for the automatic hand-over payment (the only
-- row stored without one). The list and the activity report read the two kinds as two halves of a
-- UNION ALL: the dated rows by (date, id), which also orders a page, and the undated ones through their
-- order's date and this small partial index. No stored row changes: the ledger stays append-only.
CREATE INDEX ledger_entries_undated_order_id_idx ON ledger_entries (order_id) WHERE date IS NULL;

-- Plain indexes, declared in schema.prisma: (date, id) replaces (date), which it covers.
DROP INDEX "ledger_entries_date_idx";
CREATE INDEX "ledger_entries_date_id_idx" ON "ledger_entries"("date", "id");
