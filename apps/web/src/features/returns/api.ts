import type { CustomerReturnableDto, ReturnListItemDto } from '@pallet/shared';
import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { pageQuery, type ListParams } from '@/lib/page-query';
import { qk } from '@/lib/query-keys';

/** What a customer still holds, order by order, for the return flow (Q156). */
export function customerReturnableQuery(customerId: number) {
  return queryOptions({
    queryKey: qk.orders.returnable(customerId),
    queryFn: () => apiFetch<CustomerReturnableDto>(`/customers/${customerId}/returnable`),
  });
}

/** The returns list (Q168). */
export function returnListQuery(params: ListParams) {
  return pageQuery<ReturnListItemDto>(qk.orders.returnsList(params), '/returns', params);
}
