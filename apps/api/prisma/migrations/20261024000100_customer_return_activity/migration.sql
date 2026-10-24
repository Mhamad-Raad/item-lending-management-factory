-- Q161: the dashboard lists a customer return over several orders as one event, so its orders' returns and refunds
-- are left out of the returns and refunds it lists. Each is read backwards from an index of the rows outside a visit,
-- as Q62's other kinds are, so a run of visits is never walked through. A refund carries its visit itself — its
-- return's, which the trigger below writes — so its order on the page is its own (created_at, id).

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN "customer_return_id" INTEGER;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_customer_return_id_fkey" FOREIGN KEY ("customer_return_id") REFERENCES "customer_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL (mirrored in prisma/sql/constraints.sql).
-- The foreign key's index, of the few rows that carry one: almost every ledger row has none.
CREATE INDEX ledger_entries_customer_return_id_idx
  ON ledger_entries (customer_return_id) WHERE customer_return_id IS NOT NULL;

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_customer_return_refund_check CHECK (customer_return_id IS NULL OR type = 'REFUND');

-- A refund's visit is its return's, written by the database with the row whatever the writer sent, so no writer can
-- get it wrong and the append-only ledger never needs it changed.
CREATE OR REPLACE FUNCTION ledger_refund_customer_return() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'REFUND' THEN
    NEW.customer_return_id := (SELECT r.customer_return_id FROM returns r WHERE r.id = NEW.return_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_refund_customer_return BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_refund_customer_return();

-- Replaces Q62's index of every return, which only the dashboard read.
DROP INDEX "returns_created_at_id_idx";
CREATE INDEX returns_outside_visit_created_at_id_idx
  ON returns (created_at, id) WHERE customer_return_id IS NULL;

-- Replaces the refunds' index of Q62, which only the dashboard read.
DROP INDEX ledger_entries_refunds_created_at_id_idx;
CREATE INDEX ledger_entries_refunds_outside_visit_created_at_id_idx
  ON ledger_entries (created_at, id) WHERE type = 'REFUND' AND customer_return_id IS NULL;
