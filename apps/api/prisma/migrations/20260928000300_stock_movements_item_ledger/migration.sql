-- Q102: an item's ledger page reads (item_id, id) and sums the quantities around it from the index alone,
-- and a reason filter or count is answered there too. INCLUDE is beyond schema.prisma, so this index
-- replaces the declared (item_id, id) one and lives here and in constraints.sql. Its predicate always holds
-- (item_id is NOT NULL, and every lookup by item implies it); it makes the index partial, which is what
-- keeps Prisma's schema diff from counting a raw index as drift (Q85), as for the other raw indexes.
CREATE INDEX stock_movements_item_ledger_idx
  ON stock_movements (item_id, id) INCLUDE (quantity, reason) WHERE item_id IS NOT NULL;
DROP INDEX "stock_movements_item_id_id_idx";

-- (item_id, created_at) served the item history before Q62 moved it to (item_id, id); nothing reads it now.
DROP INDEX "stock_movements_item_id_created_at_idx";
