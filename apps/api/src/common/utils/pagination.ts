import type { PageDto } from '@pallet/shared';
import { Prisma } from '../../generated/prisma/client';

/** The `?page=&pageSize=` every paginated list accepts (`PaginationQuery`). */
export interface PageQuery {
  page: number;
  pageSize: number;
}

/**
 * Prisma's `skip`/`take` for one page. The list's `orderBy` must end in a unique key (its `id`) so a
 * row cannot appear on two pages; each list names that tie-break itself.
 */
export function pageArgs({ page, pageSize }: PageQuery): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/** The same page as a raw SQL `LIMIT … OFFSET …`, after the query's own `ORDER BY`. */
export function pageSqlLimit({ page, pageSize }: PageQuery): Prisma.Sql {
  return Prisma.sql`LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
}

/** The list envelope (§6.9): the page's items, the page asked for, and the total before paging. */
export function toPage<T>(items: T[], { page, pageSize }: PageQuery, total: number): PageDto<T> {
  return { items, page, pageSize, total };
}
