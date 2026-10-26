import type { CustomerReturnEditableDto, CustomerReturnableDto, ReturnListItemDto } from '@pallet/shared';
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

/** A return as the customer screen edits it (Q174): its customer's pallets without it, and its counts by item. */
export function returnEditableQuery(returnId: number) {
  return queryOptions({
    queryKey: qk.orders.returnEditable(returnId),
    queryFn: () => apiFetch<CustomerReturnEditableDto>(`/returns/${returnId}/editable`),
  });
}

/** The returns list (Q168). */
export function returnListQuery(params: ListParams) {
  return pageQuery<ReturnListItemDto>(qk.orders.returnsList(params), '/returns', params);
}
