import { formatNumber, type ItemDto } from '@pallet/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { apiFetch } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { qk } from '@/lib/query-keys';

export function itemQuery(itemId: number) {
  return queryOptions({ queryKey: qk.items.detail(itemId), queryFn: () => apiFetch<ItemDto>(`/items/${itemId}`) });
}

/**
 * What any item, batch or stock change can make stale (§7.8.4): every item view — lists, details,
 * ledgers — the batches, which show the item's name, and the pages that total stock.
 */
export async function invalidateStock(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    [qk.items.all(), qk.purchases.all(), qk.dashboard(), qk.reports.all()].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

/**
 * STOCK_INSUFFICIENT carries what was short (§7.3.16); the toast says how many pallets were asked
 * for and how many there are. Null for any other error.
 */
export function stockShortageMessage(error: unknown, t: TFunction): string | null {
  if (!(error instanceof ApiError) || error.code !== 'STOCK_INSUFFICIENT') return null;
  const [short] = (error.details?.items as { requested: number; available: number }[] | undefined) ?? [];
  if (!short) return t('errors.STOCK_INSUFFICIENT');
  return t('items.stock.insufficient', {
    requested: formatNumber(short.requested),
    available: formatNumber(short.available),
  });
}
