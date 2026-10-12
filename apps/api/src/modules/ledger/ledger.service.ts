import { Injectable } from '@nestjs/common';
import {
  businessDateToDb,
  businessToday,
  dbDateToBusiness,
  formatOrderNumber,
  hasMoneyReceipt,
  type LedgerEntryDto,
  type LedgerEntryListQuery,
  type MoneyReceiptDto,
  type PageDto,
} from '@pallet/shared';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertDateRange } from '../../common/utils/dates';
import { toSafeMoney } from '../../common/utils/money';
import { parseSort } from '../../common/utils/sort';
import { pageSqlLimit, toPage } from '../../common/utils/pagination';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { loadReceiptFactory } from '../settings/receipt-factory';
import { USER_REF_SELECT, toUserRef } from '../users/users.mapper';
import { ledgerRowsOnEffectiveDate, type LedgerRowScope } from './effective-date';
import { replayOwedBefore } from './owed-before-replay';
import { LEDGER_ENTRY_INCLUDE, toLedgerEntryDto } from './ledger.mapper';

/** Output columns of `ledgerRowsOnEffectiveDate`, never input: the sort field is picked from this map. */
const SORT_COLUMNS = {
  effectiveDate: Prisma.sql`effective_date`,
  createdAt: Prisma.sql`entry_created_at`,
  amount: Prisma.sql`entry_amount`,
} as const;

/** The money ledger, across orders (§6.21): the order page's and the customer profile's money lists, and receipts. */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

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

  /**
   * The receipt of a payment or a refund (Q137), with the order's balance as it stood when the money moved: a
   * payment's from the figure it was checked against, a refund's from its return. A reversed row still prints,
   * saying since when it no longer counts. The parties are named as they are now, as on the hand-over receipt.
   */
  async receipt(entryId: number): Promise<MoneyReceiptDto> {
    const [entry, factory] = await Promise.all([
      this.prisma.ledgerEntry.findUnique({
        where: { id: entryId },
        include: {
          createdBy: USER_REF_SELECT,
          reversedBy: { select: { date: true } },
          return: { select: { refundDue: true, owedBefore: true } },
          order: { include: { customer: true } },
        },
      }),
      loadReceiptFactory(this.prisma),
    ]);
    if (!entry) throw new ApiError('LEDGER_ENTRY_NOT_FOUND', { ledgerEntryId: entryId });
    if (!hasMoneyReceipt(entry.type)) throw new ApiError('LEDGER_ENTRY_NO_RECEIPT', { type: entry.type });

    const amount = toSafeMoney(entry.amount);
    const { order } = entry;
    let balance: Pick<MoneyReceiptDto, 'owedBefore' | 'credit' | 'owedAfter'>;
    if (entry.type === 'PAYMENT') {
      // Stored since Q137; before that, an automatic payment was the whole deposit, and a manual one is replayed.
      const owedBefore =
        entry.owedBefore !== null
          ? toSafeMoney(entry.owedBefore)
          : entry.isAutomatic
            ? amount
            : await replayOwedBefore(this.prisma, entry.id);
      balance = { owedBefore, credit: null, owedAfter: owedBefore === null ? null : owedBefore - amount };
    } else {
      // A refund is the part of a return's credit beyond what was owed (§4.3): it leaves nothing owed.
      if (!entry.return) throw new Error(`Refund ${entry.id} has no return`);
      balance = {
        owedBefore: toSafeMoney(entry.return.owedBefore),
        credit: toSafeMoney(entry.return.refundDue),
        owedAfter: 0,
      };
    }

    return {
      ledgerEntryId: entry.id,
      receiptNumberDisplay: formatOrderNumber(entry.id),
      kind: entry.type,
      date: dbDateToBusiness(entry.date ?? order.date),
      printedOn: businessToday(this.clock.now()),
      amount,
      ...balance,
      source: entry.source,
      note: entry.note,
      recordedBy: toUserRef(entry.createdBy),
      // A reversal is dated the day it was recorded (§4.7.2).
      reversedOn: entry.reversedBy?.date ? dbDateToBusiness(entry.reversedBy.date) : null,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        orderNumberDisplay: formatOrderNumber(order.orderNumber),
        date: dbDateToBusiness(order.date),
      },
      factory,
      customer: { name: order.customer.name, phone: order.customer.phone, address: order.customer.address },
    };
  }
}
