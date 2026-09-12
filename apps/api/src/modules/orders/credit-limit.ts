import { checkCreditLimit } from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { ApiError } from '../../common/errors/api-error';
import { toSafeMoney } from '../../common/utils/money';
import type { Customer, Prisma } from '../../generated/prisma/client';

/** What an admin's override records, on the order and in its CREDIT_OVERRIDE history row. */
export interface CreditOverride {
  creditLimit: number;
  customerOutValue: number;
  depositDelta: number;
  excess: number;
}

/**
 * The credit rule of §4.4, run after the customer row is locked so no other order can slip in
 * between the sum and the decision. Returns the override to record when an admin confirmed one,
 * null when the order is within the limit; otherwise refuses with CREDIT_LIMIT_EXCEEDED.
 */
export async function assertCreditAllows(
  tx: Prisma.TransactionClient,
  customer: Pick<Customer, 'id' | 'creditLimit'>,
  depositDelta: number,
  confirmOverride: boolean,
  actor: AuthContext,
): Promise<CreditOverride | null> {
  if (customer.creditLimit === null) return null;

  const [row] = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(out_value), 0)::bigint AS total
    FROM orders WHERE customer_id = ${customer.id} AND cancelled_at IS NULL`;
  const customerOutValue = toSafeMoney(row?.total ?? 0n);
  const creditLimit = toSafeMoney(customer.creditLimit);
  const { allowed, excess } = checkCreditLimit({ creditLimit, customerOutValue, depositDelta });
  if (allowed) return null;

  const details = { creditLimit, customerOutValue, depositDelta, excess };
  if (actor.isAdmin && confirmOverride) return details;
  throw new ApiError('CREDIT_LIMIT_EXCEEDED', { ...details, canOverride: actor.isAdmin });
}
