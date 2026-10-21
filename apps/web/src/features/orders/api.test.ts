import type { OrderDetailDto } from '@pallet/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { qk } from '@/lib/query-keys';
import { invalidateAfterOrderChange, invalidateAfterPayment } from './api';

const ORDER = { id: 9, customer: { id: 3 } } as Pick<OrderDetailDto, 'id' | 'customer'>;

/** A client holding the return screen's list for customer 3 and for another customer. */
function seeded(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(qk.orders.returnable(3), { customer: { id: 3 }, orders: [] });
  client.setQueryData(qk.orders.returnable(4), { customer: { id: 4 }, orders: [] });
  return client;
}

const stale = (client: QueryClient, customerId: number) =>
  client.getQueryState(qk.orders.returnable(customerId))?.isInvalidated;

describe("what makes the return screen's list stale (Q156)", () => {
  it('a payment, which moves what the customer owes on an order', async () => {
    const client = seeded();

    await invalidateAfterPayment(client, ORDER);

    expect(stale(client, 3)).toBe(true);
    // Another customer's list does not move.
    expect(stale(client, 4)).toBe(false);
  });

  it('any order change: new orders, edits, cancels and returns', async () => {
    const client = seeded();

    await invalidateAfterOrderChange(client);

    expect(stale(client, 3)).toBe(true);
  });
});
