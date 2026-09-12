/** `'-name'` → `{ field: 'name', direction: 'desc' }`: the `sort` query of every list (§6.2). */
export function parseSort<F extends string>(sort: string): { field: F; direction: 'asc' | 'desc' } {
  const descending = sort.startsWith('-');
  return { field: (descending ? sort.slice(1) : sort) as F, direction: descending ? 'desc' : 'asc' };
}
