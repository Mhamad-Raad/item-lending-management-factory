-- Q170: pallets of a type that came back beyond what the customer had out are owed to them, given back by hand or
-- taken by their next order. The enum values come in a migration of their own: a value added to an enum cannot be used
-- until its transaction has committed, and the next migration's constraints name them.

-- CreateEnum
CREATE TYPE "pallet_credit_reason" AS ENUM ('RETURN_SURPLUS', 'RETURN_REVERSAL', 'HAND_BACK', 'ORDER_USE', 'ORDER_CANCEL', 'HAND_BACK_REVERSAL');

-- AlterEnum
ALTER TYPE "audit_entity_type" ADD VALUE 'PALLET_CREDIT';

-- AlterEnum
ALTER TYPE "stock_movement_reason" ADD VALUE 'PALLET_CREDIT';

-- AlterEnum: giving pallets back moves stock and what is owed, so it is answered once per idempotency key (§6.7).
ALTER TYPE "idempotency_scope" ADD VALUE 'PALLET_HAND_BACK';

-- AlterEnum: its history row says what it is (Q170), and so does undoing it (Q173).
ALTER TYPE "audit_action" ADD VALUE 'HAND_BACK';
ALTER TYPE "audit_action" ADD VALUE 'HAND_BACK_REVERSE';
