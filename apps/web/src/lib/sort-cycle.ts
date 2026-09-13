export type SortState = 'ascending' | 'descending' | 'none';

/** How a column stands in the `sort` in effect (`field` or `-field`). */
export function sortStateOf(sortKey: string | undefined, sort: string | undefined): SortState {
  if (!sortKey || !sort) return 'none';
  if (sort === sortKey) return 'ascending';
  return sort === `-${sortKey}` ? 'descending' : 'none';
}

/**
 * Ascending, then descending, then back to the list's default order (§7.5). When the default order is
 * this column descending, going back would leave the rows where they are, so the click turns to
 * ascending instead.
 */
export function nextSort(sortKey: string, active: string | undefined, defaultSort?: string): string | undefined {
  const state = sortStateOf(sortKey, active);
  if (state === 'none') return sortKey;
  if (state === 'ascending') return `-${sortKey}`;
  return defaultSort === active ? sortKey : undefined;
}
