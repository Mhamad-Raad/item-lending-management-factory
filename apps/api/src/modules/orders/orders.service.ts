import { Injectable } from '@nestjs/common';
import {
  assertSafe,
  businessDateToDb,
  businessToday,
  dbDateToBusiness,
  formatOrderNumber,
  type OrderCreateBody,
  type OrderDetailDto,
  type OrderListItemDto,
  type OrderListQuery,
  type PageDto,
  layoutReceiptRows,
  type ReceiptDto,
  type ReceiptOlderLineDto,
  type ReceiptRowDto,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertDateRange, assertNotInFuture, businessDateFilter } from '../../common/utils/dates';
import { toDbMoney, toSafeMoney } from '../../common/utils/money';
import { parseSort } from '../../common/utils/sort';
import { pageArgs, toPage } from '../../common/utils/pagination';
import type { Customer, Driver, LedgerEntry, Prisma } from '../../generated/prisma/client';
import { lockCustomer, lockItems, lockOrderCounter } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { runInTransaction } from '../../prisma/transaction';
import { toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService, type IdempotentRequest, type IdempotentResult } from '../idempotency/idempotency.service';
import { ledgerAuditEntry } from '../ledger/ledger.mapper';
import { MoneyLedger } from '../ledger/money-ledger';
import { loadReceiptFactory } from '../settings/receipt-factory';
import { PalletCreditsService } from '../returns/pallet-credits.service';
import { StockLedger } from '../stock/stock-ledger';
import { assertCreditAllows, type CreditOverride } from './credit-limit';
import { orderSearch } from './order-search';
import {
  assertCustomerActive,
  assertDriverActive,
  assertItemOrderable,
  assertMayPriceAndOverride,
  depositTotalOf,
  priceLine,
  type PricedLine,
} from './order-rules';
import { lineCacheSeed, recomputeOrder } from './order-state';
import { ORDER_LIST_INCLUDE, netFromCredit, toOrderListItemDto } from './orders.mapper';
import { loadOrderDetail } from './orders.queries';

const SORT_FIELDS = { orderNumber: 'orderNumber', date: 'date', owed: 'owed', outValue: 'outValue' } as const;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly stock: StockLedger,
    private readonly money: MoneyLedger,
    private readonly credits: PalletCreditsService,
  ) {}

  async list(query: OrderListQuery): Promise<PageDto<OrderListItemDto>> {
    assertDateRange(query.dateFrom, query.dateTo);
    const where: Prisma.OrderWhereInput = {
      ...(query.status === 'ALL' ? {} : { status: query.status }),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(query.paymentType ? { paymentType: query.paymentType } : {}),
      ...(query.itemId ? { lines: { some: { itemId: query.itemId } } } : {}),
      date: businessDateFilter(query.dateFrom, query.dateTo),
      ...(query.q ? await this.searchFilter(query.q) : {}),
    };
    const { field, direction } = parseSort<keyof typeof SORT_FIELDS>(query.sort);

    // The order number is unique: a tie-break by id would only stop the planner walking its index in order.
    const orderBy: Prisma.OrderOrderByWithRelationInput[] =
      field === 'orderNumber' ? [{ orderNumber: direction }] : [{ [SORT_FIELDS[field]]: direction }, { id: direction }];

    const [total, page] = await Promise.all([
      this.prisma.order.count({ where }),
      // The page's ids first, then only those orders with their customer and driver: a deep page no longer
      // carries every skipped order's full row (a deferred join, Q100; offset 250,000: 66 -> 26 ms).
      this.prisma.order.findMany({ where, select: { id: true }, orderBy, ...pageArgs(query) }),
    ]);
    const rows = await this.prisma.order.findMany({
      where: { id: { in: page.map((row) => row.id) } },
      include: ORDER_LIST_INCLUDE,
      orderBy,
    });
    return toPage(rows.map(toOrderListItemDto), query, total);
  }

  /** The search box (§6.19, `orderSearch`): the order with that number, or the orders of the customers named. */
  private async searchFilter(q: string): Promise<Prisma.OrderWhereInput> {
    const { customerIds, orderNumber } = await orderSearch(this.prisma, q);
    const byCustomerName: Prisma.OrderWhereInput = { customerId: { in: customerIds } };
    return orderNumber === null ? byCustomerName : { OR: [{ orderNumber }, byCustomerName] };
  }

  get(orderId: number): Promise<OrderDetailDto> {
    return loadOrderDetail(this.prisma, orderId);
  }

  /** The hand-over (§4.8.1, §6.19): once per idempotency key, in one transaction. */
  create(
    body: OrderCreateBody,
    actor: AuthContext,
    request: IdempotentRequest,
  ): Promise<IdempotentResult<OrderDetailDto>> {
    // The stored answer comes before every check (§6.19 step 1): a retry of an order that exists
    // must get that order back, even if the permission or the date would refuse it today.
    return this.idempotency.run(request, ({ store, replayIfStored }) => {
      assertMayPriceAndOverride(body.lines, body.confirmCreditOverride, actor);
      assertNotInFuture(this.clock, body.date, 'date');
      return runInTransaction(this.prisma, async (tx) => {
        const { customer, driver } = await this.loadParties(tx, body);
        // Under the customer lock: a same-key submission that committed while this one waited is the answer.
        await replayIfStored(tx);
        // Pallets the factory owes the customer go out first, with no deposit; only the rest are lent (Q170).
        const fromCredit = await this.credits.planOrderUse(tx, customer.id, body.lines);
        const lent = body.lines.map((line) => ({
          ...line,
          quantity: line.quantity - (fromCredit.get(line.itemId) ?? 0),
        }));
        // Stock is checked on all that goes out, owed pallets included, so a shortage names the whole count.
        const priced = await this.priceLines(tx, lent, body.lines);
        const lines = priced.lines.filter((line) => line.quantity > 0);
        if (lines.length === 0) throw new ApiError('ORDER_ALL_FROM_CREDIT');
        const { depositTotal } = priced;
        const override = await assertCreditAllows(tx, customer, depositTotal, body.confirmCreditOverride, actor);

        const orderNumber = (await lockOrderCounter(tx)) + 1;
        await tx.orderCounter.update({ where: { id: 1 }, data: { lastNumber: orderNumber } });
        const order = await tx.order.create({
          data: {
            orderNumber,
            customerId: customer.id,
            driverId: driver.id,
            date: businessDateToDb(body.date),
            paymentType: body.paymentType,
            notes: body.notes ?? null,
            createdByUserId: actor.userId,
            ...(override ? { creditOverrideByUserId: actor.userId, creditOverrideAt: this.clock.now() } : {}),
            lines: {
              create: lines.map((line) => ({
                itemId: line.itemId,
                quantity: line.quantity,
                unitDeposit: toDbMoney(line.unitDeposit),
                lineTotal: toDbMoney(line.lineTotal),
                ...lineCacheSeed(line.quantity),
              })),
            },
          },
        });

        await this.stock.apply(
          tx,
          lines.map((line) => ({
            itemId: line.itemId,
            quantity: -line.quantity,
            reason: 'ORDER_CREATE' as const,
            orderId: order.id,
          })),
          actor.userId,
        );
        await this.credits.useForOrder(tx, customer.id, order.id, fromCredit, body.date, actor);
        // A cash order is paid at the hand-over: the automatic payment, dated by the order (§4.7.2).
        const payment =
          body.paymentType === 'CASH' && depositTotal > 0
            ? await this.money.record(
                tx,
                {
                  orderId: order.id,
                  type: 'PAYMENT',
                  source: 'ORDER_CREATE',
                  amount: depositTotal,
                  date: null,
                  isAutomatic: true,
                  // The whole deposit was owed, and this pays it (Q137).
                  owedBefore: depositTotal,
                },
                actor.userId,
              )
            : null;
        await recomputeOrder(tx, order.id, { bumpVersion: false });

        await this.auditCreate(tx, { orderId: order.id, customerName: customer.name, payment, override });
        const detail = await loadOrderDetail(tx, order.id);
        await store(tx, detail);
        return detail;
      });
    });
  }

  /** The customer, locked first in the chain (§6.6), and the driver; both must exist and be active. */
  private async loadParties(
    tx: Prisma.TransactionClient,
    body: Pick<OrderCreateBody, 'customerId' | 'driverId'>,
  ): Promise<{ customer: Customer; driver: Driver }> {
    await lockCustomer(tx, body.customerId);
    const customer = await tx.customer.findUnique({ where: { id: body.customerId } });
    assertCustomerActive(customer, body.customerId);

    const driver = await tx.driver.findUnique({ where: { id: body.driverId } });
    assertDriverActive(driver, body.driverId);
    return { customer, driver };
  }

  /**
   * Locks the lines' items, checks each exists and is active, prices it — the item's deposit unless
   * the line sets one — and refuses stock that is not there (§6.19 steps 8–9).
   */
  private async priceLines(
    tx: Prisma.TransactionClient,
    input: OrderCreateBody['lines'],
    /** All the order hands over, its pallets owed included (Q170): what is locked and checked against stock. */
    handedOver: readonly { itemId: number; quantity: number }[] = input,
  ): Promise<{ lines: PricedLine[]; depositTotal: number }> {
    const itemIds = input.map((line) => line.itemId);
    await lockItems(
      tx,
      handedOver.map((line) => line.itemId),
    );
    const items = new Map((await tx.item.findMany({ where: { id: { in: itemIds } } })).map((item) => [item.id, item]));

    const lines = input.map((line, index) => {
      const item = items.get(line.itemId);
      assertItemOrderable(item, line.itemId);
      return priceLine(line, toSafeMoney(item.depositPrice), index);
    });
    await this.stock.assertAvailable(
      tx,
      handedOver.map((line) => ({ itemId: line.itemId, quantity: -line.quantity })),
    );

    return { lines, depositTotal: depositTotalOf(lines) };
  }

  /** The history of a hand-over (§11.3): the order, its automatic payment, and an admin's override. */
  private async auditCreate(
    tx: Prisma.TransactionClient,
    created: { orderId: number; customerName: string; payment: LedgerEntry | null; override: CreditOverride | null },
  ): Promise<void> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: created.orderId },
      include: { lines: { orderBy: { id: 'asc' } } },
    });
    const { orderNumber } = order;
    const depositTotal = toSafeMoney(order.depositTotal);

    await this.audit.record(tx, {
      action: 'CREATE',
      entityType: 'ORDER',
      entityId: String(order.id),
      summaryParams: { orderNumber, customerName: created.customerName, paymentType: order.paymentType, depositTotal },
      after: {
        ...toAuditSnapshot('ORDER', order),
        lines: order.lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          unitDeposit: toSafeMoney(line.unitDeposit),
          lineTotal: toSafeMoney(line.lineTotal),
        })),
      },
    });
    if (created.payment) await this.audit.record(tx, ledgerAuditEntry(created.payment, orderNumber));
    if (created.override) {
      await this.audit.record(tx, {
        action: 'CREDIT_OVERRIDE',
        entityType: 'ORDER',
        entityId: String(order.id),
        summaryParams: { orderNumber, customerName: created.customerName, excess: created.override.excess },
        after: created.override,
      });
    }
  }

  /**
   * The printed hand-over (§6.19, §7.16): this order's lines, then those of the customer's earlier orders still out
   * (Q150), in one table — six rows to a half, both copies on one A4 sheet, or a page per copy when there are more.
   * A line also says what has come back so far (Q134), from the totals `recomputeOrder()` keeps on it, and the
   * receipt the day those figures were read.
   */
  async receipt(orderId: number): Promise<ReceiptDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        driver: true,
        lines: { orderBy: { id: 'asc' }, include: { item: true } },
        palletCredits: { orderBy: { id: 'asc' }, include: { item: { select: { name: true } } } },
      },
    });
    if (!order) throw new ApiError('ORDER_NOT_FOUND', { orderId });
    if (order.cancelledAt) throw new ApiError('ORDER_CANCELLED', { orderId });

    // Earlier by order number, the order of creation (A6): a reprint never takes in an order made after this one.
    // Pallets still out are only ever on an OPEN order (a settled one holds nothing, a cancelled one is zeroed), so
    // the customer's settled history is never read: `orders (customer_id, status)` narrows to the open ones.
    const olderLines = await this.prisma.orderLine.findMany({
      where: {
        outQuantity: { gt: 0 },
        order: { customerId: order.customerId, status: 'OPEN', orderNumber: { lt: order.orderNumber } },
      },
      include: { item: { select: { name: true } } },
      orderBy: [{ order: { orderNumber: 'asc' } }, { id: 'asc' }],
    });

    const rows: ReceiptRowDto[] = order.lines.map((line, index) => ({
      kind: 'line',
      no: index + 1,
      itemName: line.item.name,
      quantity: line.quantity,
      unitDeposit: toSafeMoney(line.unitDeposit),
      lineTotal: toSafeMoney(line.lineTotal),
      returnedAccepted: line.returnedAccepted,
      returnedDamaged: line.returnedDamaged,
      outQuantity: line.outQuantity,
    }));
    // Pallets the factory owed, handed over with this order and no deposit (Q170), numbered on from its lines.
    for (const { first, quantity } of netFromCredit(order.palletCredits)) {
      rows.push({ kind: 'fromCredit', no: rows.length + 1, itemName: first.item.name, quantity });
    }
    const ownRows = rows.length;
    // One row per item and deposit price over all the earlier orders (Q158), in the order each first appears: the
    // same item lent at another price keeps its own row, so every row's out × unit deposit is its total.
    const older = new Map<string, Omit<ReceiptOlderLineDto, 'outValue'>>();
    for (const line of olderLines) {
      const unitDeposit = toSafeMoney(line.unitDeposit);
      const key = `${line.itemId}:${unitDeposit}`;
      const row = older.get(key) ?? { itemName: line.item.name, unitDeposit, outQuantity: 0 };
      row.outQuantity = assertSafe(row.outQuantity + line.outQuantity, 'outQuantity');
      older.set(key, row);
    }
    let olderOutValue = 0;
    if (older.size > 0) rows.push({ kind: 'olderHeading' });
    [...older.values()].forEach((row, index) => {
      const outValue = assertSafe(row.outQuantity * row.unitDeposit, 'outValue');
      olderOutValue = assertSafe(olderOutValue + outValue, 'olderOutValue');
      rows.push({ kind: 'older', no: ownRows + index + 1, ...row, outValue });
    });

    const { layout, rowsPerCopy, chunks } = layoutReceiptRows(rows, (row) => row.kind === 'olderHeading');
    const depositTotal = toSafeMoney(order.depositTotal);
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderNumberDisplay: formatOrderNumber(order.orderNumber),
      date: dbDateToBusiness(order.date),
      printedOn: businessToday(this.clock.now()),
      paymentType: order.paymentType,
      depositTotal,
      factory: await loadReceiptFactory(this.prisma),
      customer: {
        name: order.customer.name,
        phone: order.customer.phone,
        altPhone: order.customer.altPhone,
        address: order.customer.address,
      },
      driver: { name: order.driver.name, phone: order.driver.phone, carNumber: order.driver.carNumber },
      layout,
      rowsPerCopy,
      sheets: chunks.map((chunk, index) => ({
        sheetNumber: index + 1,
        sheetCount: chunks.length,
        rows: chunk,
        showTotal: index === chunks.length - 1,
      })),
      older:
        older.size > 0
          ? { outValue: olderOutValue, combinedTotal: assertSafe(depositTotal + olderOutValue, 'combinedTotal') }
          : null,
    };
  }
}
