-- Q161: a customer's return over several orders is one visit with one receipt and one history row. Each order still
-- gets its own return (§4.8.4); the visit is a row they point to. Returns recorded before keep NULL there: the
-- returns table is append-only, and which of them were one visit cannot be told after the fact.

ALTER TYPE "audit_entity_type" ADD VALUE 'CUSTOMER_RETURN';

-- CreateTable
CREATE TABLE "customer_returns" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "customer_returns_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "returns" ADD COLUMN "customer_return_id" INTEGER;

-- CreateIndex
CREATE INDEX "customer_returns_customer_id_idx" ON "customer_returns"("customer_id");

-- CreateIndex
CREATE INDEX "customer_returns_created_at_id_idx" ON "customer_returns"("created_at", "id");

-- CreateIndex
CREATE INDEX "customer_returns_created_by_user_id_idx" ON "customer_returns"("created_by_user_id");

-- CreateIndex
CREATE INDEX "returns_customer_return_id_idx" ON "returns"("customer_return_id");

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_customer_return_id_fkey" FOREIGN KEY ("customer_return_id") REFERENCES "customer_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL (mirrored in prisma/sql/constraints.sql): the visit is append-only, like the returns it groups.
CREATE TRIGGER forbid_update_delete BEFORE UPDATE OR DELETE ON customer_returns
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- A return's visit is written with it and never changed: the reversal's one UPDATE leaves it as it was.
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
      NEW.customer_return_id, NEW.created_at, NEW.created_by_user_id)
     IS DISTINCT FROM
     (OLD.id, OLD.order_id, OLD.date, OLD.notes, OLD.refund_due, OLD.owed_before, OLD.cash_refund,
      OLD.customer_return_id, OLD.created_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'only reversal columns of returns may be updated' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
