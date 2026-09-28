import { Injectable } from '@nestjs/common';
import { businessDateToDb, type LedgerEntryDto, type LedgerEntryListQuery, type PageDto } from '@pallet/shared';
import { assertDateRange } from '../../common/utils/dates';
import { parseSort } from '../../common/utils/sort';
import { pageSqlLimit, toPage } from '../../common/utils/pagination';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ledgerRowsOnEffectiveDate, type LedgerRowScope } from './effective-date';
import { LEDGER_ENTRY_INCLUDE, toLedgerEntryDto } from './ledger.mapper';

/** Output columns of `ledgerRowsOnEffectiveDate`, never input: the sort field is picked from this map. */
const SORT_COLUMNS = {
  effectiveDate: Prisma.sql`effective_date`,
  createdAt: Prisma.sql`entry_created_at`,
  amount: Prisma.sql`entry_amount`,
} as const;

/** The money ledger, across orders (§6.21): the order page's and the customer profile's money lists. */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: LedgerEntryListQuery): Promise<PageDto<LedgerEntryDto>> {
    assertDateRange(query.dateFrom, query.dateTo);

    // The effective date is the row's own or its order's: two indexable halves, filtered and sorted in SQL (Q98).
    const scope: LedgerRowScope = {
      liveOrdersOnly: !query.includeCancelledOrders,
      orderConditions: query.customerId ? [Prisma.sql`o.customer_id = ${query.customerId}`] : [],
      rowConditions: query.orderId ? [Prisma.sql`le.order_id = ${query.orderId}`] : [],
      ...(query.type ? { types: query.type } : {}),
      ...(query.dateFrom ? { dateFrom: businessDateToDb(query.dateFrom) } : {}),
      ...(query.dateTo ? { dateTo: businessDateToDb(query.dateTo) } : {}),
    };

    const { field, direction } = parseSort<keyof typeof SORT_COLUMNS>(query.sort);
    const order = direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const orderBy = Prisma.sql`${SORT_COLUMNS[field]} ${order}, entry_id ${order}`;
    // Each half stops where the page does; the page is then cut from the two together.
    const reach = query.page * query.pageSize;

    const [page, counted] = await Promise.all([
      this.prisma.$queryRaw<{ id: number }[]>`
        SELECT entry_id AS id FROM (${ledgerRowsOnEffectiveDate(scope, { orderBy, limit: reach })}) rows
        ORDER BY ${orderBy}
        ${pageSqlLimit(query)}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total FROM (${ledgerRowsOnEffectiveDate(scope)}) rows`,
    ]);

    const rows = await this.prisma.ledgerEntry.findMany({
      where: { id: { in: page.map((row) => row.id) } },
      include: { ...LEDGER_ENTRY_INCLUDE, order: { include: { customer: true } } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return toPage(
      page.flatMap(({ id }) => {
        const row = byId.get(id);
        return row ? [toLedgerEntryDto(row, row.order)] : [];
      }),
      query,
      counted[0]?.total ?? 0,
    );
  }
}
