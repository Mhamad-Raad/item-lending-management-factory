import type { CustomerReturnReceiptDto, MoneyReceiptDto, ReceiptDto, TransactionsReceiptDto } from '@pallet/shared';
import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

// Each receipt is read afresh for every print (`staleTime: 0`): it says what has come back so far (Q134), a payment
// deleted since must print as deleted (Q137), and the totals are the day's (Q139).

/** The hand-over receipt (§7.16). */
export function orderReceiptQuery(orderId: number) {
  return queryOptions({
    queryKey: qk.orders.receipt(orderId),
    queryFn: () => apiFetch<ReceiptDto>(`/orders/${orderId}/receipt`),
    staleTime: 0,
  });
}

/** One payment's or refund's receipt (§7.16.6). */
export function moneyReceiptQuery(entryId: number) {
  return queryOptions({
    queryKey: qk.ledger.receipt(entryId),
    queryFn: () => apiFetch<MoneyReceiptDto>(`/ledger-entries/${entryId}/receipt`),
    staleTime: 0,
  });
}

/** A customer return's one receipt over the orders it touched (Q161). */
export function customerReturnReceiptQuery(customerReturnId: number) {
  return queryOptions({
    queryKey: qk.ledger.customerReturnReceipt(customerReturnId),
    queryFn: () => apiFetch<CustomerReturnReceiptDto>(`/customer-returns/${customerReturnId}/receipt`),
    staleTime: 0,
  });
}

/** All of an order's payments and refunds (§7.16.7). */
export function transactionsReceiptQuery(orderId: number) {
  return queryOptions({
    queryKey: qk.orders.transactionsReceipt(orderId),
    queryFn: () => apiFetch<TransactionsReceiptDto>(`/orders/${orderId}/transactions-receipt`),
    staleTime: 0,
  });
}
