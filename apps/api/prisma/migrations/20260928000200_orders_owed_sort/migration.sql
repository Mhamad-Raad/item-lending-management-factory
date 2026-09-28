-- Q100: the order list sorted by what is owed, across every status, reads the first page from an index
-- instead of sorting all orders (30 ms at 300,000 orders; the sort is a column header on /orders).
CREATE INDEX "orders_owed_id_idx" ON "orders"("owed", "id");
