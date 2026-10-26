import { toWesternDigits } from '@pallet/shared';
import { escapeLikePattern } from '../../common/utils/search';
import type { Prisma } from '../../generated/prisma/client';

/** An order number is at most nine digits here; a longer run of digits can only be a name. */
const ORDER_NUMBER_QUERY = /^\d{1,9}$/;

/**
 * The order number a search means, if it is one: as the app shows it (`#000123`), or typed in Eastern digits on a
 * Sorani or Arabic keyboard.
 */
export function orderNumberOf(q: string): number | null {
  const digits = toWesternDigits(q).replace(/^#/, '');
  return ORDER_NUMBER_QUERY.test(digits) ? Number(digits) : null;
}

/**
 * The search box of a list of orders, or of what hangs off them (§6.19): the order with that number, or the orders of
 * the customers whose name contains the text. The matching customers are found first (a few thousand rows at most),
 * so the rows are read by order number and customer id from their indexes; one condition across the order and its
 * customer's name could only be answered by reading every order (Q101). Shared by the orders and returns lists (Q168).
 */
export async function orderSearch(
  client: Prisma.TransactionClient,
  q: string,
): Promise<{ customerIds: number[]; orderNumber: number | null }> {
  const customers = await client.customer.findMany({
    where: { name: { contains: escapeLikePattern(q), mode: 'insensitive' } },
    select: { id: true },
  });
  return { customerIds: customers.map((customer) => customer.id), orderNumber: orderNumberOf(q) };
}
