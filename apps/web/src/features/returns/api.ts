import type { CustomerReturnableDto } from '@pallet/shared';
import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

/** What a customer still holds, order by order, for the return flow (Q156). */
export function customerReturnableQuery(customerId: number) {
  return queryOptions({
    queryKey: qk.orders.returnable(customerId),
    queryFn: () => apiFetch<CustomerReturnableDto>(`/customers/${customerId}/returnable`),
  });
}
