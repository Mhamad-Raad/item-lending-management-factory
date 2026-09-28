-- Q104: the append-only ledgers only grow, so autovacuum visits them for their inserts alone, by default once
-- a fifth of the table is new (200,000 rows into a ten-year audit log). Until then the visibility map lags and
-- the index-only reads of Q98, Q100 and Q102 fetch the table after all. One per cent keeps them index-only.
ALTER TABLE audit_logs SET (autovacuum_vacuum_insert_scale_factor = 0.01);
ALTER TABLE stock_movements SET (autovacuum_vacuum_insert_scale_factor = 0.01);
ALTER TABLE ledger_entries SET (autovacuum_vacuum_insert_scale_factor = 0.01);
