/**
 * Escapes the LIKE wildcards in free-text search input. Prisma compiles `contains` to
 * `ILIKE '%' || $1 || '%'` and passes the value through untouched, so a `%` or `_` typed into a
 * search box would otherwise be read as a pattern: `%` matches everything, `_` any character.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
