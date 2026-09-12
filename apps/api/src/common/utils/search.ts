import { normalizePhone } from '@pallet/shared';

/**
 * Escapes the LIKE wildcards in free-text search input. Prisma compiles `contains` to
 * `ILIKE '%' || $1 || '%'` and passes the value through untouched, so a `%` or `_` typed into a
 * search box would otherwise be read as a pattern: `%` matches everything, `_` any character.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * The phone half of a search: the input normalised like a stored phone (Q13), so "0750 123" finds
 * 07501234567. Undefined when nothing is left to match on.
 */
export function phoneSearchPattern(value: string): string | undefined {
  const normalised = normalizePhone(value);
  return normalised === '' ? undefined : escapeLikePattern(normalised);
}
