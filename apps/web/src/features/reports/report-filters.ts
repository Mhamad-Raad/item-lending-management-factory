import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useCan } from '@/lib/auth';
import { qk } from '@/lib/query-keys';

type FilterKind = 'customer' | 'driver' | 'item';

const PATHS = { customer: '/customers', driver: '/drivers', item: '/items' } as const;
const KEYS = { customer: qk.customers, driver: qk.drivers, item: qk.items } as const;
const VIEW = { customer: 'customers.view', driver: 'drivers.view', item: 'items.view' } as const;

/** Whether the viewer may pick and open this kind: a report permission alone does not include it. */
export function useCanFilterBy(kind: FilterKind): boolean {
  return useCan(VIEW[kind]);
}

/**
 * The name of a filtered entity for the printed filter line. It shares the picker's cached record; a
 * viewer who may not read the entity gets its number instead.
 */
export function useFilterName(kind: FilterKind, id: number | undefined): string | undefined {
  const allowed = useCanFilterBy(kind);
  const record = useQuery({
    queryKey: KEYS[kind].detail(id ?? 0),
    queryFn: () => apiFetch<{ name: string }>(`${PATHS[kind]}/${id}`),
    enabled: id !== undefined && allowed,
    staleTime: 60_000,
  });
  if (id === undefined) return undefined;
  return record.data?.name ?? `#${id}`;
}
