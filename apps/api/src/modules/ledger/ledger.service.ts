import { Injectable } from '@nestjs/common';
import { businessDateToDb, type LedgerEntryDto, type LedgerEntryListQuery, type PageDto } from '@pallet/shared';
import { assertDateRange } from '../../common/utils/dates';
import { parseSort } from '../../common/utils/sort';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LEDGER_ENTRY_INCLUDE, toLedgerEntryDto } from './ledger.mapper';

/** Column expressions, never input: the sort field is picked from this map. */
const SORT_COLUMNS = {
  effectiveDate: Prisma.sql`COALESCE(le.date, o.date)`,
  createdAt: Prisma.sql`le.created_at`,
  amount: Prisma.sql`le.amount`,
} as const;

/** The money ledger, across orders (§6.21): the order page's and the customer profile's money lists. */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: LedgerEntryListQuery): Promise<PageDto<LedgerEntryDto>> {
    assertDateRange(query.dateFrom, query.dateTo);

    // The effective date is the row's own or its order's, so filtering and sorting on it is SQL.
    const effectiveDate = Prisma.sql`COALESCE(le.date, o.date)`;
    const conditions: Prisma.Sql[] = [];
    if (!query.includeCancelledOrders) conditions.push(Prisma.sql`o.cancelled_at IS NULL`);
    if (query.customerId) conditions.push(Prisma.sql`o.customer_id = ${query.customerId}`);
    if (query.orderId) conditions.push(Prisma.sql`le.order_id = ${query.orderId}`);
    if (query.type) conditions.push(Prisma.sql`le.type::text = ANY(${query.type}::text[])`);
    if (query.dateFrom) conditions.push(Prisma.sql`${effectiveDate} >= ${businessDateToDb(query.dateFrom)}`);
    if (query.dateTo) conditions.push(Prisma.sql`${effectiveDate} <= ${businessDateToDb(query.dateTo)}`);
    const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const { field, direction } = parseSort<keyof typeof SORT_COLUMNS>(query.sort);
    const order = direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const from = Prisma.sql`FROM ledger_entries le JOIN orders o ON o.id = le.order_id`;

    const [page, counted] = await Promise.all([
      this.prisma.$queryRaw<{ id: number }[]>`
        SELECT le.id ${from} ${where}
        ORDER BY ${SORT_COLUMNS[field]} ${order}, le.id ${order}
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      this.prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total ${from} ${where}`,
    ]);

    const rows = await this.prisma.ledgerEntry.findMany({
      where: { id: { in: page.map((row) => row.id) } },
      include: { ...LEDGER_ENTRY_INCLUDE, order: { include: { customer: true } } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      items: page.flatMap(({ id }) => {
        const row = byId.get(id);
        return row ? [toLedgerEntryDto(row, row.order)] : [];
      }),
      page: query.page,
      pageSize: query.pageSize,
      total: counted[0]?.total ?? 0,
    };
  }
}
