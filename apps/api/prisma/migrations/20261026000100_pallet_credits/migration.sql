-- Q170: the pallet credit ledger — what a customer is owed of each pallet type, append-only like the other ledgers,
-- each row mirrored by one stock movement of its own sign; a return's surplus names the return, an order's use the order.

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "pallet_credit_id" INTEGER;

-- CreateTable
CREATE TABLE "pallet_credits" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" "pallet_credit_reason" NOT NULL,
    "return_id" INTEGER,
    "order_id" INTEGER,
    "reverses_credit_id" INTEGER,
    "hand_back_number" INTEGER,
    "date" DATE NOT NULL,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "pallet_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pallet_credits_customer_id_item_id_idx" ON "pallet_credits"("customer_id", "item_id");

-- CreateIndex
CREATE INDEX "pallet_credits_item_id_idx" ON "pallet_credits"("item_id");

-- CreateIndex
CREATE INDEX "pallet_credits_return_id_idx" ON "pallet_credits"("return_id");

-- CreateIndex
CREATE INDEX "pallet_credits_order_id_idx" ON "pallet_credits"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "pallet_credits_reverses_credit_id_key" ON "pallet_credits"("reverses_credit_id");

-- CreateIndex
CREATE UNIQUE INDEX "pallet_credits_hand_back_number_key" ON "pallet_credits"("hand_back_number");

-- CreateIndex
CREATE INDEX "pallet_credits_created_by_user_id_idx" ON "pallet_credits"("created_by_user_id");

-- CreateIndex
CREATE INDEX "stock_movements_pallet_credit_id_idx" ON "stock_movements"("pallet_credit_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_pallet_credit_id_fkey" FOREIGN KEY ("pallet_credit_id") REFERENCES "pallet_credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_credits" ADD CONSTRAINT "pallet_credits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_credits" ADD CONSTRAINT "pallet_credits_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_credits" ADD CONSTRAINT "pallet_credits_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_credits" ADD CONSTRAINT "pallet_credits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_credits" ADD CONSTRAINT "pallet_credits_reverses_credit_id_fkey" FOREIGN KEY ("reverses_credit_id") REFERENCES "pallet_credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_credits" ADD CONSTRAINT "pallet_credits_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL (mirrored in prisma/sql/constraints.sql).

-- A surplus is owed (+) and names its return; its reversal takes it back (−) and names the same return; a hand-back
-- gives pallets back (−) and names nothing; an order's use (−) and its cancel's giving it back (+) name the order;
-- a give-back's undo (+) names the give-back (Q173).
ALTER TABLE pallet_credits
  ADD CONSTRAINT pallet_credits_reason_check CHECK (
    (reason = 'RETURN_SURPLUS' AND quantity > 0 AND return_id IS NOT NULL AND order_id IS NULL AND reverses_credit_id IS NULL)
    OR (reason = 'RETURN_REVERSAL' AND quantity < 0 AND return_id IS NOT NULL AND order_id IS NULL AND reverses_credit_id IS NULL)
    OR (reason = 'HAND_BACK' AND quantity < 0 AND return_id IS NULL AND order_id IS NULL AND reverses_credit_id IS NULL)
    OR (reason = 'ORDER_USE' AND quantity < 0 AND order_id IS NOT NULL AND return_id IS NULL AND reverses_credit_id IS NULL)
    OR (reason = 'ORDER_CANCEL' AND quantity > 0 AND order_id IS NOT NULL AND return_id IS NULL AND reverses_credit_id IS NULL)
    OR (reason = 'HAND_BACK_REVERSAL' AND quantity > 0 AND reverses_credit_id IS NOT NULL AND return_id IS NULL AND order_id IS NULL)
  );

CREATE TRIGGER forbid_update_delete BEFORE UPDATE OR DELETE ON pallet_credits
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- A give-back's paper number (Q172): its own run, given by the database as the row is written, so two give-backs at
-- once never share or swap a number; every other entry has none.
CREATE SEQUENCE pallet_hand_back_number_seq OWNED BY pallet_credits.hand_back_number;
CREATE OR REPLACE FUNCTION pallet_credits_hand_back_number() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.hand_back_number := CASE WHEN NEW.reason = 'HAND_BACK' THEN nextval('pallet_hand_back_number_seq') END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pallet_credits_hand_back_number BEFORE INSERT ON pallet_credits
  FOR EACH ROW EXECUTE FUNCTION pallet_credits_hand_back_number();
ALTER TABLE pallet_credits
  ADD CONSTRAINT pallet_credits_hand_back_number_check CHECK ((reason = 'HAND_BACK') = (hand_back_number IS NOT NULL));

-- A credit's stock movement names it and nothing else, of either sign.
ALTER TABLE stock_movements
  DROP CONSTRAINT stock_movements_reference_matches_reason_check,
  DROP CONSTRAINT stock_movements_quantity_sign_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_reference_matches_reason_check CHECK (
    (reason IN ('BATCH_ADD', 'BATCH_EDIT', 'BATCH_DELETE')
      AND batch_id IS NOT NULL AND order_id IS NULL AND return_id IS NULL AND pallet_credit_id IS NULL)
    OR (reason IN ('ORDER_CREATE', 'ORDER_LINE_EDIT', 'ORDER_CANCEL')
      AND order_id IS NOT NULL AND batch_id IS NULL AND return_id IS NULL AND pallet_credit_id IS NULL)
    OR (reason IN ('RETURN_ACCEPTED', 'RETURN_EDIT', 'RETURN_DELETE')
      AND return_id IS NOT NULL AND order_id IS NOT NULL AND batch_id IS NULL AND pallet_credit_id IS NULL)
    OR (reason = 'MANUAL_ADJUSTMENT'
      AND note IS NOT NULL AND btrim(note) <> '' AND batch_id IS NULL AND order_id IS NULL AND return_id IS NULL
      AND pallet_credit_id IS NULL)
    OR (reason = 'PALLET_CREDIT'
      AND pallet_credit_id IS NOT NULL AND batch_id IS NULL AND order_id IS NULL AND return_id IS NULL)
  ),
  ADD CONSTRAINT stock_movements_quantity_sign_check CHECK (
    (reason IN ('BATCH_ADD', 'ORDER_CANCEL', 'RETURN_ACCEPTED') AND quantity > 0)
    OR (reason IN ('BATCH_DELETE', 'ORDER_CREATE', 'RETURN_EDIT', 'RETURN_DELETE') AND quantity < 0)
    OR reason IN ('BATCH_EDIT', 'ORDER_LINE_EDIT', 'MANUAL_ADJUSTMENT', 'PALLET_CREDIT')
  );
