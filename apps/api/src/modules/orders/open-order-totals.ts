import { Prisma } from '../../generated/prisma/client';

/**
 * The standing totals per customer, summed over its OPEN orders (§4.5, Q62): `customer_id`,
 * `pallets_out`, `out_value`, `owed`, `held` (all `bigint`) and `open_order_count` (`int`).
 *
 * A SETTLED order has all four sums at zero (`orders_settled_nothing_standing_check`) and a cancelled
 * one is never OPEN, so these equal the sums over every live order while reading only what is still
 * standing, from the covering partial index on open orders. A customer with no open order has no row.
 * `scope` narrows the orders read, e.g. `AND customer_id = ANY(...)`; it sees the columns of `orders`
 * unqualified. The customer list, the positions report, the dashboard and the credit check all read
 * their standing totals through this one query.
 */
export function openOrderTotalsByCustomer(scope: Prisma.Sql = Prisma.empty): Prisma.Sql {
  return Prisma.sql`
    SELECT customer_id,
           SUM(out_quantity_total)::bigint AS pallets_out,
           SUM(out_value)::bigint AS out_value,
           SUM(owed)::bigint AS owed,
           SUM(held)::bigint AS held,
           COUNT(*)::int AS open_order_count
      FROM orders
     WHERE status = 'OPEN' ${scope}
     GROUP BY customer_id`;
}
