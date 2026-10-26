import { Injectable } from '@nestjs/common';
import {
  businessDateToDb,
  businessToday,
  chunkReceiptLines,
  dbDateToBusiness,
  formatOrderNumber,
  hasMoneyReceipt,
  RECEIPT_LEDGER_ENTRY_TYPES,
  RECEIPT_LINES_PER_HALF,
  type CustomerReturnReceiptDto,
  type ReturnReceiptDto,
  type ReturnReceiptLineDto,
  type LedgerEntryDto,
  type LedgerEntryListQuery,
  type MoneyReceiptDto,
  type PageDto,
  type TransactionsReceiptDto,
  type TransactionsReceiptRowDto,
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
import { openOutByItem } from '../orders/open-out';
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

/** What a return's receipt lists of its lines (Q167), oldest line first. */
const RECEIPT_LINES_INCLUDE = {
  orderBy: { id: 'asc' },
  include: { orderLine: { select: { item: { select: { id: true, name: true } } } } },
} satisfies Prisma.PalletReturn$linesArgs;

type ReceiptLineRow = Prisma.ReturnLineGetPayload<{ include: (typeof RECEIPT_LINES_INCLUDE)['include'] }>;

/**
 * A return's lines as its receipt lists them (Q167): one row per pallet type and deposit — over several orders a type
 * at one deposit is one row, at two deposits two — in the order they first came back.
 */
function receiptLines(
  lines: ReceiptLineRow[],
  withCustomer: Map<number, number>,
  extra: Map<number, number>,
): ReturnReceiptLineDto[] {
  const extraLeft = new Map(extra);
  const rows = new Map<string, ReturnReceiptLineDto>();
  for (const line of lines) {
    const unitDeposit = toSafeMoney(line.unitDeposit);
    const { id: itemId, name: itemName } = line.orderLine.item;
    const key = `${itemId}:${unitDeposit}`;
    const row = rows.get(key) ?? {
      itemName,
      accepted: 0,
      damaged: 0,
      unitDeposit,
      total: 0,
      withCustomer: withCustomer.get(itemId) ?? 0,
      // An item's surplus is told once, on its first row (Q170).
      extra: extraLeft.get(itemId) ?? 0,
    };
    extraLeft.delete(itemId);
    row.accepted += line.acceptedQuantity;
    row.damaged += line.damagedQuantity;
    row.total += line.acceptedQuantity * unitDeposit + toSafeMoney(line.damagedRefund);
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** The money ledger, across orders (§6.21): the order page's and the customer profile's money lists, and receipts. */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /**
   * A return's lines for its receipt (Q167), each with how many of its pallet type the customer still holds over all
   * their orders now, as the hand-over receipt says what is still out when printed (Q134, Q169). A cancelled order's
   * lines hold nothing (Q39).
   */
  private async returnReceiptLines(
    customerId: number,
    lines: ReceiptLineRow[],
    returnIds: number[],
  ): Promise<ReturnReceiptLineDto[]> {
    if (lines.length === 0) return [];
    const [held, surplus] = await Promise.all([
      openOutByItem(
        this.prisma,
        customerId,
        lines.map((line) => line.orderLine.item.id),
      ),
      // What came back beyond what was out, as recorded with the return: a reprint says what the original said (Q170).
      this.prisma.palletCredit.groupBy({
        by: ['itemId'],
        where: { returnId: { in: returnIds }, reason: 'RETURN_SURPLUS' },
        _sum: { quantity: true },
      }),
    ]);
    return receiptLines(lines, held, new Map(surplus.map((row) => [row.itemId, row._sum.quantity ?? 0])));
  }

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
          return: { select: { refundDue: true, owedBefore: true, lines: RECEIPT_LINES_INCLUDE } },
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
      lines: await this.returnReceiptLines(
        order.customerId,
        entry.return?.lines ?? [],
        entry.returnId === null ? [] : [entry.returnId],
      ),
    };
  }

  /**
   * The one paper of a customer's return over several orders (Q161): the money receipt's figures summed over its
   * orders' returns as they were recorded, so a reprint says what the original said; a visit that paid nothing back
   * prints too, its cash 0 (Q166). A return of it corrected or deleted since leaves the figures and stamps the paper
   * with the latest day one was.
   */
  async customerReturnReceipt(customerReturnId: number): Promise<CustomerReturnReceiptDto> {
    const [visit, factory] = await Promise.all([
      this.prisma.customerReturn.findUnique({
        where: { id: customerReturnId },
        include: {
          customer: true,
          createdBy: USER_REF_SELECT,
          returns: { orderBy: { id: 'asc' }, include: { lines: RECEIPT_LINES_INCLUDE } },
        },
      }),
      loadReceiptFactory(this.prisma),
    ]);
    if (!visit) throw new ApiError('CUSTOMER_RETURN_NOT_FOUND', { customerReturnId });
    const { returns } = visit;
    const sum = (pick: (pr: (typeof returns)[number]) => bigint) =>
      returns.reduce((total, pr) => total + toSafeMoney(pick(pr)), 0);
    const amount = sum((pr) => pr.cashRefund);

    const owedBefore = sum((pr) => pr.owedBefore);
    const credit = sum((pr) => pr.refundDue);
    const reversals = returns.flatMap((pr) => (pr.reversedAt ? [businessToday(pr.reversedAt)] : []));
    return {
      customerReturnId: visit.id,
      receiptNumberDisplay: formatOrderNumber(visit.id),
      date: dbDateToBusiness(visit.date),
      printedOn: businessToday(this.clock.now()),
      owedBefore,
      credit,
      amount,
      // Each order owed max(0, before − credit) after its return (§4.3), and its cash was the rest: Σ after is this.
      owedAfter: owedBefore - credit + amount,
      // One note for the visit, written on each of its returns.
      note: returns[0]?.notes ?? null,
      recordedBy: toUserRef(visit.createdBy),
      // ISO dates sort as text.
      reversedOn: reversals.sort().at(-1) ?? null,
      allReversed: reversals.length === returns.length,
      factory,
      customer: { name: visit.customer.name, phone: visit.customer.phone, address: visit.customer.address },
      lines: await this.returnReceiptLines(
        visit.customerId,
        returns.flatMap((pr) => pr.lines),
        returns.map((pr) => pr.id),
      ),
    };
  }

  /**
   * One return's paper (Q166), the customer return's for that return alone with its order: what a return that paid no
   * cash back prints, as it has no money receipt. Its figures are the return's as recorded; corrected or deleted
   * since, the paper is stamped with that day.
   */
  async returnReceipt(returnId: number): Promise<ReturnReceiptDto> {
    const [pr, factory] = await Promise.all([
      this.prisma.palletReturn.findUnique({
        where: { id: returnId },
        include: {
          createdBy: USER_REF_SELECT,
          order: { include: { customer: true } },
          lines: RECEIPT_LINES_INCLUDE,
        },
      }),
      loadReceiptFactory(this.prisma),
    ]);
    if (!pr) throw new ApiError('RETURN_NOT_FOUND', { returnId });
    const { order } = pr;
    const owedBefore = toSafeMoney(pr.owedBefore);
    const credit = toSafeMoney(pr.refundDue);
    const amount = toSafeMoney(pr.cashRefund);
    return {
      returnId: pr.id,
      receiptNumberDisplay: formatOrderNumber(pr.id),
      date: dbDateToBusiness(pr.date),
      printedOn: businessToday(this.clock.now()),
      owedBefore,
      credit,
      amount,
      // What the order still owed after it: max(0, before − credit) (§4.3), the cash being the rest.
      owedAfter: owedBefore - credit + amount,
      note: pr.notes,
      recordedBy: toUserRef(pr.createdBy),
      reversedOn: pr.reversedAt ? businessToday(pr.reversedAt) : null,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        orderNumberDisplay: formatOrderNumber(order.orderNumber),
        date: dbDateToBusiness(order.date),
      },
      factory,
      customer: { name: order.customer.name, phone: order.customer.phone, address: order.customer.address },
      lines: await this.returnReceiptLines(order.customerId, pr.lines, [pr.id]),
    };
  }

  /**
   * Every payment and refund of an order on one paper (Q139), by the day the money moved, six to a half like the
   * hand-over receipt's lines. A reversed one is listed with the day it was reversed and left out of the totals;
   * the reversal rows themselves are not listed. A cancelled order still prints, like its money receipts.
   */
  async transactionsReceipt(orderId: number): Promise<TransactionsReceiptDto> {
    const [order, factory] = await Promise.all([
      this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          customer: true,
          ledgerEntries: {
            where: { type: { in: [...RECEIPT_LEDGER_ENTRY_TYPES] } },
            include: { reversedBy: { select: { date: true } } },
          },
        },
      }),
      loadReceiptFactory(this.prisma),
    ]);
    if (!order) throw new ApiError('ORDER_NOT_FOUND', { orderId });

    const rows: TransactionsReceiptRowDto[] = order.ledgerEntries
      // The query took these types alone; the guard narrows the type for the row, without a cast.
      .flatMap((entry) =>
        hasMoneyReceipt(entry.type)
          ? [
              {
                ledgerEntryId: entry.id,
                receiptNumberDisplay: formatOrderNumber(entry.id),
                kind: entry.type,
                // An automatic payment is dated by its order (§4.7.2), as on its own receipt.
                date: dbDateToBusiness(entry.date ?? order.date),
                amount: toSafeMoney(entry.amount),
                reversedOn: entry.reversedBy?.date ? dbDateToBusiness(entry.reversedBy.date) : null,
              },
            ]
          : [],
      )
      // ISO dates sort as text; the same day keeps recording order.
      .sort((a, b) => a.date.localeCompare(b.date) || a.ledgerEntryId - b.ledgerEntryId);
    const standing = (kind: TransactionsReceiptRowDto['kind']) =>
      rows.filter((row) => row.kind === kind && row.reversedOn === null).reduce((sum, row) => sum + row.amount, 0);

    const chunks = chunkReceiptLines(rows);
    return {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        orderNumberDisplay: formatOrderNumber(order.orderNumber),
        date: dbDateToBusiness(order.date),
      },
      printedOn: businessToday(this.clock.now()),
      factory,
      customer: { name: order.customer.name, phone: order.customer.phone, address: order.customer.address },
      received: standing('PAYMENT'),
      refunded: standing('REFUND'),
      owed: toSafeMoney(order.owed),
      rowsPerHalf: RECEIPT_LINES_PER_HALF,
      sheets: chunks.map((chunk, index) => ({
        sheetNumber: index + 1,
        sheetCount: chunks.length,
        rows: chunk,
        showTotal: index === chunks.length - 1,
      })),
    };
  }
}
