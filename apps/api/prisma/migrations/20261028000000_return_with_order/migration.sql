-- Q175: a return recorded from an order's page may take back the customer's pallets of other orders too. Each part
-- still lands on the order it came from; every part remembers the order it was recorded with, so that order's receipt
-- lists what came back with it and the other order's receipt says how its pallets came back. Returns recorded before
-- keep NULL: the returns table is append-only, and where they were recorded cannot be told after the fact.

-- AlterTable
ALTER TABLE "returns" ADD COLUMN "with_order_id" INTEGER;

-- CreateIndex
CREATE INDEX "returns_with_order_id_idx" ON "returns"("with_order_id");

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_with_order_id_fkey" FOREIGN KEY ("with_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL (mirrored in prisma/sql/constraints.sql): the order a return was recorded with is written with it and never
-- changed — the reversal's one UPDATE leaves it as it was.
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
      NEW.customer_return_id, NEW.with_order_id, NEW.created_at, NEW.created_by_user_id)
     IS DISTINCT FROM
     (OLD.id, OLD.order_id, OLD.date, OLD.notes, OLD.refund_due, OLD.owed_before, OLD.cash_refund,
      OLD.customer_return_id, OLD.with_order_id, OLD.created_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'only reversal columns of returns may be updated' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- The order a return was recorded with is one of the same customer's.
CREATE OR REPLACE FUNCTION returns_with_order_same_customer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.with_order_id IS NOT NULL AND
     (SELECT o.customer_id FROM orders o WHERE o.id = NEW.with_order_id)
       IS DISTINCT FROM (SELECT o.customer_id FROM orders o WHERE o.id = NEW.order_id) THEN
    RAISE EXCEPTION 'a return is recorded with an order of its own customer' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER returns_with_order_same_customer BEFORE INSERT ON returns
  FOR EACH ROW EXECUTE FUNCTION returns_with_order_same_customer();
