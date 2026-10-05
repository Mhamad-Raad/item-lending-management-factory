import { Phone } from '@pallet/shared';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { apiFetch } from '@/lib/api-client';

/**
 * The live duplicate-phone check of a form (§7.3.11, §7.3.13): 400 ms after the typed phone becomes a valid one,
 * the records that already hold it, by the same comparison the save makes. Empty while the box holds no phone.
 */
export function usePhoneMatches<Match>(
  phone: string | null | undefined,
  check: { path: string; key: (normalized: string, excludeId: number | undefined) => QueryKey; excludeId?: number },
): Match[] {
  const typed = useDebouncedValue(phone ?? '', 400);
  const parsed = Phone.safeParse(typed);
  const normalized = parsed.success ? parsed.data : null;

  const matches = useQuery({
    queryKey: check.key(normalized ?? '', check.excludeId),
    queryFn: () =>
      apiFetch<{ matches: Match[] }>(check.path, { query: { phone: normalized, excludeId: check.excludeId } }),
    enabled: normalized !== null,
    staleTime: 30_000,
  });
  return normalized !== null ? (matches.data?.matches ?? []) : [];
}
