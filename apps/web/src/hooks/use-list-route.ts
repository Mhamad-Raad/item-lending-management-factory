import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useSearchInput } from './use-search-input';

/** The list routes this hook serves. */
type ListRoutePath = '/customers/' | '/drivers/' | '/items/' | '/orders/' | '/users/' | '/history';

/** The search params every paginated list keeps in the URL (`listSearch` in `lib/list-search.ts`). */
interface ListSearchParams {
  q?: string;
  page: number;
  pageSize?: number;
  sort?: string;
}

/**
 * The URL plumbing every list route shares (§7.2), so each page only says what it filters on:
 *
 * - `term`/`setTerm`: the search box, reaching `q` after a pause (`useSearchInput`), back to page 1;
 * - `setFilter`: a filter, sort or page-size change, back to page 1 — replacing the history entry, as
 *   a filter is a refinement of the same page, not a new one;
 * - `pageProps`: what `DataTable` needs to page — a page change pushes an entry (Back returns to the
 *   previous page), stepping back from past the end replaces it (no Back-button trap);
 * - `clearFilters`: every filter gone at once, keeping `keep`.
 *
 * `from` is the route's `Route.fullPath` and `search` its `Route.useSearch()`: every navigation stays
 * on that route and changes only its search params.
 */
export function useListRoute<S extends ListSearchParams>(from: ListRoutePath, search: S) {
  const navigate = useNavigate({ from });
  const update = useCallback(
    (next: (prev: S) => S, replace: boolean): void => void navigate({ search: (prev) => next(prev as S), replace }),
    [navigate],
  );

  const commitSearch = useCallback(
    (q: string | undefined) => update((prev) => ({ ...prev, q, page: 1 }), true),
    [update],
  );
  const [term, setTerm] = useSearchInput(search.q, commitSearch);
  const setFilter = (patch: Partial<S>): void => update((prev) => ({ ...prev, ...patch, page: 1 }), true);

  return {
    term,
    setTerm,
    setFilter,
    clearFilters: (keep: Partial<S> = {}): void => void navigate({ search: keep, replace: true }),
    pageProps: {
      onSortChange: (sort: string | undefined) => setFilter({ sort } as Partial<S>),
      onPageChange: (page: number) => update((prev) => ({ ...prev, page }), false),
      onPageOverflow: (page: number) => update((prev) => ({ ...prev, page }), true),
      onPageSizeChange: (pageSize: number) => setFilter({ pageSize } as Partial<S>),
    },
  };
}
