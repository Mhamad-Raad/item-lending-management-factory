import type { CustomerDetailDto } from '@pallet/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

export function customerQuery(customerId: number) {
  return queryOptions({
    queryKey: qk.customers.detail(customerId),
    queryFn: () => apiFetch<CustomerDetailDto>(`/customers/${customerId}`),
  });
}

/** A customer create, edit or archive can change any customer view (§7.8.4). */
export function invalidateCustomers(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: qk.customers.all() });
}
