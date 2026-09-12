import { z } from 'zod';

export const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * The search params every list page keeps in the URL (§7.2). A value that does not parse — an old
 * bookmark, a hand-edited address — falls back to the default instead of failing the page.
 */
export const listSearch = {
  q: z.string().optional().catch(undefined),
  page: z.coerce.number().int().min(1).default(1).catch(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((size) => (PAGE_SIZES as readonly number[]).includes(size))
    .default(25)
    .catch(25),
};

/** `sort` over a list's sortable fields, `-` for descending; absent means the list's default order. */
export function sortSearch(fields: readonly string[]) {
  const values = fields.flatMap((field) => [field, `-${field}`]);
  return z
    .string()
    .refine((value) => values.includes(value))
    .optional()
    .catch(undefined);
}

/** A switch filter: in the URL only while it is on. */
export const flagSearch = z.boolean().optional().catch(undefined);
