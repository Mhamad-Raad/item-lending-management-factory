import { Injectable } from '@nestjs/common';
import {
  RECEIPT_LINES_PER_HALF,
  businessDateToDb,
  chunkReceiptLines,
  dbDateToBusiness,
  formatOrderNumber,
  toWesternDigits,
  type OrderCreateBody,
  type OrderDetailDto,
  type OrderListItemDto,
  type OrderListQuery,
  type PageDto,
  type ReceiptDto,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertDateRange, assertNotInFuture, businessDateFilter } from '../../common/utils/dates';
import { toDbMoney, toSafeMoney } from '../../common/utils/money';
import { escapeLikePattern } from '../../common/utils/search';
import { parseSort } from '../../common/utils/sort';
import type { Customer, Driver, LedgerEntry, Prisma } from '../../generated/prisma/client';
import { lockCustomer, lockItems, lockOrderCounter } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { runInTransaction } from '../../prisma/transaction';
import { toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService, type IdempotentRequest, type IdempotentResult } from '../idempotency/idempotency.service';
import { ledgerAuditEntry } from '../ledger/ledger.mapper';
import { MoneyLedger } from '../ledger/money-ledger';
import { uploadUrl } from '../uploads/uploads.mapper';
import { StockLedger } from '../stock/stock-ledger';
import { assertCreditAllows, type CreditOverride } from './credit-limit';
import {
  assertItemOrderable,
  assertMayPriceAndOverride,
  depositTotalOf,
  priceLine,
  type PricedLine,
} from './order-rules';
import { recomputeOrder } from './order-state';
import { ORDER_LIST_INCLUDE, toOrderListItemDto } from './orders.mapper';
import { loadOrderDetail } from './orders.queries';

const SORT_FIELDS = { orderNumber: 'orderNumber', date: 'date', owed: 'owed', outValue: 'outValue' } as const;

/** An order number is at most nine digits here; a longer run of digits can only be a name. */
const ORDER_NUMBER_QUERY = /^\d{1,9}$/;

/**
 * The order number a search means, if it is one: as the app shows it (`#000123`), or typed in Eastern digits on a
 * Sorani or Arabic keyboard.
 */
function orderNumberOf(q: string): number | null {
  const digits = toWesternDigits(q).replace(/^#/, '');
  return ORDER_NUMBER_QUERY.test(digits) ? Number(digits) : null;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly stock: StockLedger,
    private readonly money: MoneyLedger,
  ) {}

  async list(query: OrderListQuery): Promise<PageDto<OrderListItemDto>> {
    assertDateRange(query.dateFrom, query.dateTo);
    const byCustomerName: Prisma.OrderWhereInput = query.q
      ? { customer: { name: { contains: escapeLikePattern(query.q), mode: 'insensitive' } } }
      : {};
    const orderNumber = query.q ? orderNumberOf(query.q) : null;
    const where: Prisma.OrderWhereInput = {
      ...(query.status === 'ALL' ? {} : { status: query.status }),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(query.paymentType ? { paymentType: query.paymentType } : {}),
      ...(query.itemId ? { lines: { some: { itemId: query.itemId } } } : {}),
      date: businessDateFilter(query.dateFrom, query.dateTo),
      ...(query.q ? (orderNumber === null ? byCustomerName : { OR: [{ orderNumber }, byCustomerName] }) : {}),
    };
    const { field, direction } = parseSort<keyof typeof SORT_FIELDS>(query.sort);

    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: ORDER_LIST_INCLUDE,
        orderBy: [{ [SORT_FIELDS[field]]: direction }, { id: direction }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toOrderListItemDto), page: query.page, pageSize: query.pageSize, total };
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
        const { lines, depositTotal } = await this.priceLines(tx, body.lines);
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
                outQuantity: line.quantity,
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
    if (!customer) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId: body.customerId });
    if (customer.archivedAt) throw new ApiError('CUSTOMER_ARCHIVED', { customerId: body.customerId });

    const driver = await tx.driver.findUnique({ where: { id: body.driverId } });
    if (!driver) throw new ApiError('DRIVER_NOT_FOUND', { driverId: body.driverId });
    if (driver.archivedAt) throw new ApiError('DRIVER_ARCHIVED', { driverId: body.driverId });
    return { customer, driver };
  }

  /**
   * Locks the lines' items, checks each exists and is active, prices it — the item's deposit unless
   * the line sets one — and refuses stock that is not there (§6.19 steps 8–9).
   */
  private async priceLines(
    tx: Prisma.TransactionClient,
    input: OrderCreateBody['lines'],
  ): Promise<{ lines: PricedLine[]; depositTotal: number }> {
    const itemIds = input.map((line) => line.itemId);
    await lockItems(tx, itemIds);
    const items = new Map((await tx.item.findMany({ where: { id: { in: itemIds } } })).map((item) => [item.id, item]));

    const lines = input.map((line, index) => {
      const item = items.get(line.itemId);
      assertItemOrderable(item, line.itemId);
      return priceLine(line, toSafeMoney(item.depositPrice), index);
    });
    await this.stock.assertAvailable(
      tx,
      lines.map((line) => ({ itemId: line.itemId, quantity: -line.quantity })),
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

  /** The printed hand-over (§6.19, §7.16): lines in chunks of six, each chunk on its own A4 sheet. */
  async receipt(orderId: number): Promise<ReceiptDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, driver: true, lines: { orderBy: { id: 'asc' }, include: { item: true } } },
    });
    if (!order) throw new ApiError('ORDER_NOT_FOUND', { orderId });
    if (order.cancelledAt) throw new ApiError('ORDER_CANCELLED', { orderId });
    const settings = await this.prisma.factorySettings.findUniqueOrThrow({
      where: { id: 1 },
      include: { logo: { select: { fileName: true } } },
    });

    const chunks = chunkReceiptLines(
      order.lines.map((line) => ({
        itemName: line.item.name,
        quantity: line.quantity,
        unitDeposit: toSafeMoney(line.unitDeposit),
        lineTotal: toSafeMoney(line.lineTotal),
      })),
    );
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderNumberDisplay: formatOrderNumber(order.orderNumber),
      date: dbDateToBusiness(order.date),
      paymentType: order.paymentType,
      depositTotal: toSafeMoney(order.depositTotal),
      factory: {
        name: settings.factoryName,
        phone: settings.phone,
        address: settings.address,
        logoUrl: settings.logo ? uploadUrl(settings.logo.fileName) : null,
      },
      customer: {
        name: order.customer.name,
        phone: order.customer.phone,
        altPhone: order.customer.altPhone,
        address: order.customer.address,
      },
      driver: { name: order.driver.name, phone: order.driver.phone, carNumber: order.driver.carNumber },
      linesPerHalf: RECEIPT_LINES_PER_HALF,
      sheets: chunks.map((lines, index) => ({
        sheetNumber: index + 1,
        sheetCount: chunks.length,
        lines,
        showTotal: index === chunks.length - 1,
      })),
    };
  }
}
