import type { PageDto } from '@pallet/shared';
import { keepPreviousData, queryOptions, type QueryKey } from '@tanstack/react-query';
import { apiFetch, type QueryValue } from '@/lib/api-client';

/** A list's query params as they go on the URL of the request. */
export type ListParams = Record<string, QueryValue>;

/**
 * One page of a list (§7.8.2). The page on screen stays while the next one loads — no skeleton between
 * pages or filters, and the filters keep their focus.
 */
export function pageQuery<T>(queryKey: QueryKey, path: string, params: ListParams) {
  return queryOptions({
    queryKey,
    queryFn: () => apiFetch<PageDto<T>>(path, { query: params }),
    placeholderData: keepPreviousData,
  });
}
