import { Injectable } from '@nestjs/common';
import {
  businessDateToDb,
  businessToday,
  computeOrderTotals,
  dbDateToBusiness,
  type CustomerReturnCreateBody,
  type CustomerReturnRecordedDto,
  type CustomerReturnResultDto,
  type CustomerReturnableDto,
  type ErrorDetails,
  type OrderState,
  type ReturnCreateBody,
  type ReturnResultDto,
  orderStateWithoutReturn,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertNotInFuture } from '../../common/utils/dates';
import { toDbMoney, toSafeMoney } from '../../common/utils/money';
import type { LedgerEntry, Prisma } from '../../generated/prisma/client';
import { lockCustomer, lockItems, lockOrder, lockOrders } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { runInTransaction } from '../../prisma/transaction';
import { toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService, type IdempotentRequest, type IdempotentResult } from '../idempotency/idempotency.service';
import { ledgerAuditEntry } from '../ledger/ledger.mapper';
import { MoneyLedger } from '../ledger/money-ledger';
import { toCustomerRef } from '../customers/customers.mapper';
import { ITEM_REF_INCLUDE } from '../items/items.mapper';
import { recomputeOrder, toOrderState } from '../orders/order-state';
import { toOrderLineDto } from '../orders/orders.mapper';
import { loadOrderDetail } from '../orders/orders.queries';
import { StockLedger, type StockMovementInput } from '../stock/stock-ledger';
import { priceReturn, validateReturnAgainstOrder, type PricedReturnLine } from './return-rules';

/** An order with everything a return reads: lines, returns with their lines, and the ledger with reversals. */
const RETURN_ORDER_INCLUDE = {
  lines: { orderBy: { id: 'asc' } },
  returns: {
    orderBy: { id: 'asc' },
    include: {
      lines: { orderBy: { id: 'asc' }, include: { orderLine: { include: { item: { select: { name: true } } } } } },
    },
  },
  ledgerEntries: { orderBy: { id: 'asc' }, include: { reversedBy: { select: { id: true } } } },
} as const satisfies Prisma.OrderInclude;

type ReturnOrder = Prisma.OrderGetPayload<{ include: typeof RETURN_ORDER_INCLUDE }>;
type StoredReturn = ReturnOrder['returns'][number];

/** Returns: recorded, replaced by a corrected one, or deleted as if they never happened (§4.8.4–§4.8.6, §6.20). */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly stock: StockLedger,
    private readonly money: MoneyLedger,
  ) {}

  /** Once per idempotency key; a known key is answered before any check (§6.7). */
  create(
    orderId: number,
    body: ReturnCreateBody,
    actor: AuthContext,
    request: IdempotentRequest,
  ): Promise<IdempotentResult<ReturnResultDto>> {
    return this.idempotency.run(request, ({ store, replayIfStored }) => {
      assertNotInFuture(this.clock, body.date, 'date');
      return runInTransaction(this.prisma, async (tx) => {
        await lockOrder(tx, orderId);
        await replayIfStored(tx);
        const order = await this.loadOrder(tx, orderId);
        await lockItems(tx, this.itemIdsOf(order, body.lines));

        const { priced, money } = this.check(order, body);
        const created = await this.write(tx, order, body, priced, money, actor);

        const result = { returnId: created.returnId, order: await loadOrderDetail(tx, order.id) };
        await store(tx, result);
        return result;
      });
    });
  }

  /** A customer's pallets still out, on their open orders, oldest order first (Q156). */
  async returnableFor(customerId: number): Promise<CustomerReturnableDto> {
    // Pallets are out only on an OPEN order (Q150): `orders (customer_id, status)` narrows to those.
    const [customer, orders] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: customerId } }),
      this.prisma.order.findMany({
        where: { customerId, status: 'OPEN', outQuantityTotal: { gt: 0 } },
        include: {
          lines: { where: { outQuantity: { gt: 0 } }, orderBy: { id: 'asc' }, include: { item: ITEM_REF_INCLUDE } },
        },
        orderBy: { orderNumber: 'asc' },
      }),
    ]);
    if (!customer) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId });
    return {
      customer: toCustomerRef(customer),
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        date: dbDateToBusiness(order.date),
        paymentType: order.paymentType,
        owed: toSafeMoney(order.owed),
        outQuantityTotal: order.outQuantityTotal,
        lines: order.lines.map(toOrderLineDto),
      })),
    };
  }

  /**
   * What came back of a customer's pallets, across their open orders (Q156): a return on each order named, each
   * checked and priced against its own order exactly as `create`, all in one transaction — every one or none. Locks
   * in the order of §6.6: the customer, the orders by id, then their items. Once per idempotency key (§6.7).
   */
  createForCustomer(
    customerId: number,
    body: CustomerReturnCreateBody,
    actor: AuthContext,
    request: IdempotentRequest,
  ): Promise<IdempotentResult<CustomerReturnResultDto>> {
    return this.idempotency.run(request, ({ store, replayIfStored }) => {
      assertNotInFuture(this.clock, body.date, 'date');
      return runInTransaction(this.prisma, async (tx) => {
        await lockCustomer(tx, customerId);
        await replayIfStored(tx);
        const customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (!customer) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId });
        if (body.orders.length === 0) throw new ApiError('RETURN_EMPTY');

        // An order's customer never changes, so it is read before any order is locked: another customer's order is
        // refused as not found here — whatever its state — and never locked under the wrong customer (§6.6).
        const ids = body.orders.map((entry) => entry.orderId);
        const owners = new Map(
          (await tx.order.findMany({ where: { id: { in: ids } }, select: { id: true, customerId: true } })).map(
            (row) => [row.id, row.customerId],
          ),
        );
        const foreign = ids.find((id) => owners.get(id) !== customerId);
        if (foreign !== undefined) throw new ApiError('ORDER_NOT_FOUND', { orderId: foreign });
        await lockOrders(tx, ids);
        const loaded = await tx.order.findMany({
          where: { id: { in: ids } },
          include: RETURN_ORDER_INCLUDE,
          orderBy: { id: 'asc' },
        });
        const orders = loaded.map((order) => {
          if (order.cancelledAt) throw new ApiError('ORDER_CANCELLED', { orderId: order.id });
          const entry = body.orders.find((named) => named.orderId === order.id);
          return { order, body: { date: body.date, notes: body.notes, lines: entry?.lines ?? [] } };
        });
        await lockItems(
          tx,
          orders.flatMap(({ order, body: one }) => this.itemIdsOf(order, one.lines)),
        );

        // Every order is checked before any is written. Lines over what is out are collected across the orders into
        // one answer; any other refusal stops at the first, and the lines collected so far go unnamed — the screen
        // refuses those as they are typed, so the server's own over-out answer only meets counts gone stale.
        const over: ErrorDetails<'RETURN_EXCEEDS_OUT'>['lines'] = [];
        const checked = orders.flatMap(({ order, body: one }) => {
          try {
            return [{ order, body: one, ...this.check(order, one) }];
          } catch (error) {
            if (!(error instanceof ApiError) || error.code !== 'RETURN_EXCEEDS_OUT') throw error;
            over.push(...(error.details as ErrorDetails<'RETURN_EXCEEDS_OUT'>).lines);
            return [];
          }
        });
        if (over.length > 0) {
          throw new ApiError('RETURN_EXCEEDS_OUT', { lines: over } satisfies ErrorDetails<'RETURN_EXCEEDS_OUT'>);
        }

        const returns: CustomerReturnRecordedDto[] = [];
        for (const { order, body: one, priced, money } of checked.sort(
          (a, b) => a.order.orderNumber - b.order.orderNumber,
        )) {
          const written = await this.write(tx, order, one, priced, money, actor);
          returns.push({
            ...written,
            orderId: order.id,
            orderNumber: order.orderNumber,
            refundDue: money.refundDue,
            owedBefore: money.owedBefore,
            cashRefund: money.cashRefund,
            owedAfter: money.owedAfter,
          });
        }
        const result = { customer: toCustomerRef(customer), returns };
        await store(tx, result);
        return result;
      });
    });
  }

  /** `validateReturnAgainstOrder` and the price of §4.3, against the locked order as it stands. */
  private check(order: ReturnOrder, body: ReturnCreateBody) {
    const state = toOrderState(order);
    const priced = validateReturnAgainstOrder(this.returnable(order, state), body);
    return { priced, money: priceReturn(priced, computeOrderTotals(state).owed) };
  }

  /** Writes a checked return on its locked order (§4.8.4): the row, its stock, its refund, the totals, the audit. */
  private async write(
    tx: Prisma.TransactionClient,
    order: ReturnOrder,
    body: ReturnCreateBody,
    priced: PricedReturnLine[],
    money: ReturnType<typeof priceReturn>,
    actor: AuthContext,
  ): Promise<{ returnId: number; refundEntryId: number | null; accepted: number; damaged: number }> {
    const accepted = priced.reduce((total, line) => total + line.acceptedQuantity, 0);
    const damaged = priced.reduce((total, line) => total + line.damagedQuantity, 0);
    const created = await this.insertReturn(tx, order.id, body, priced, money, actor.userId);
    await this.stock.apply(tx, this.accepted(priced, 'RETURN_ACCEPTED', order.id, created.id, 1), actor.userId);
    const refund = await this.refund(tx, order.id, created.id, 'RETURN_CREATE', body.date, money.cashRefund, actor);
    await recomputeOrder(tx, order.id, { bumpVersion: true });

    await this.audit.record(tx, {
      action: 'RETURN_CREATE',
      entityType: 'RETURN',
      entityId: String(created.id),
      summaryParams: {
        orderNumber: order.orderNumber,
        accepted,
        damaged,
        refundDue: money.refundDue,
        cashRefund: money.cashRefund,
      },
      after: await this.snapshot(tx, created.id),
    });
    if (refund) await this.audit.record(tx, ledgerAuditEntry(refund, order.orderNumber));
    return { returnId: created.id, refundEntryId: refund?.id ?? null, accepted, damaged };
  }

  /**
   * An edit (§4.8.5): the return is reversed and a corrected one recorded in its place, checked and
   * priced against the order as it would stand without the old one. Other returns' cash refunds are
   * never recomputed. Not idempotent: a repeat finds the old return reversed.
   */
  replace(returnId: number, body: ReturnCreateBody, actor: AuthContext): Promise<ReturnResultDto> {
    assertNotInFuture(this.clock, body.date, 'date');
    return runInTransaction(this.prisma, async (tx) => {
      const { order, old } = await this.lockReturn(tx, returnId);
      await lockItems(tx, [...old.lines.map((line) => line.orderLine.itemId), ...this.itemIdsOf(order, body.lines)]);

      const standingRefund = this.standingRefund(order, old.id);
      const without = this.stateWithout(order, old.id, standingRefund);
      const priced = validateReturnAgainstOrder(this.returnable(order, without), body);
      const money = priceReturn(priced, computeOrderTotals(without).owed);

      const created = await this.insertReturn(tx, order.id, body, priced, money, actor.userId);
      // One call, so the stock check judges each item on the net of taking the old pallets out and the new ones in (Q20).
      await this.stock.apply(
        tx,
        [
          ...this.accepted(this.linesOf(old), 'RETURN_EDIT', order.id, old.id, -1),
          ...this.accepted(priced, 'RETURN_ACCEPTED', order.id, created.id, 1),
        ],
        actor.userId,
      );
      const reversal = standingRefund
        ? await this.reverseRefund(tx, order.id, old.id, standingRefund, 'RETURN_EDIT', actor)
        : null;
      const refund = await this.refund(tx, order.id, created.id, 'RETURN_EDIT', body.date, money.cashRefund, actor);
      await tx.palletReturn.update({
        where: { id: old.id },
        data: {
          reversedAt: this.clock.now(),
          reversedByUserId: actor.userId,
          reversalKind: 'EDIT',
          replacedByReturnId: created.id,
        },
      });
      await recomputeOrder(tx, order.id, { bumpVersion: true });

      await this.audit.record(tx, {
        action: 'RETURN_EDIT',
        entityType: 'RETURN',
        entityId: String(old.id),
        summaryParams: { orderNumber: order.orderNumber, newReturnId: created.id },
        before: this.snapshotOf(old),
        after: await this.snapshot(tx, created.id),
      });
      for (const entry of [reversal, refund]) {
        if (entry) await this.audit.record(tx, ledgerAuditEntry(entry, order.orderNumber));
      }
      return { returnId: created.id, order: await loadOrderDetail(tx, order.id) };
    });
  }

  /** A deletion (§4.8.6): the return never happened — its pallets go back out and its refund is reversed. */
  delete(returnId: number, actor: AuthContext): Promise<ReturnResultDto> {
    return runInTransaction(this.prisma, async (tx) => {
      const { order, old } = await this.lockReturn(tx, returnId);
      await lockItems(
        tx,
        old.lines.map((line) => line.orderLine.itemId),
      );

      await this.stock.apply(tx, this.accepted(this.linesOf(old), 'RETURN_DELETE', order.id, old.id, -1), actor.userId);
      const standingRefund = this.standingRefund(order, old.id);
      const reversal = standingRefund
        ? await this.reverseRefund(tx, order.id, old.id, standingRefund, 'RETURN_DELETE', actor)
        : null;
      const reversedAt = this.clock.now();
      await tx.palletReturn.update({
        where: { id: old.id },
        data: { reversedAt, reversedByUserId: actor.userId, reversalKind: 'DELETE' },
      });
      await recomputeOrder(tx, order.id, { bumpVersion: true });

      await this.audit.record(tx, {
        action: 'RETURN_DELETE',
        entityType: 'RETURN',
        entityId: String(old.id),
        summaryParams: { orderNumber: order.orderNumber },
        before: this.snapshotOf(old),
        after: { reversedAt: reversedAt.toISOString(), reversalKind: 'DELETE' },
      });
      if (reversal) await this.audit.record(tx, ledgerAuditEntry(reversal, order.orderNumber));
      return { returnId: old.id, order: await loadOrderDetail(tx, order.id) };
    });
  }

  /** The order, which the caller has locked; a cancelled order takes no returns. */
  private async loadOrder(tx: Prisma.TransactionClient, orderId: number): Promise<ReturnOrder> {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: RETURN_ORDER_INCLUDE });
    if (!order) throw new ApiError('ORDER_NOT_FOUND', { orderId });
    if (order.cancelledAt) throw new ApiError('ORDER_CANCELLED', { orderId });
    return order;
  }

  /**
   * Finds a return's order and customer unlocked — neither ever changes — locks them in the global order (§6.6), and
   * re-reads the return under the locks. The customer first (Q47): taking the return back puts pallets out again and
   * raises the out value the credit check sums under that lock.
   */
  private async lockReturn(
    tx: Prisma.TransactionClient,
    returnId: number,
  ): Promise<{ order: ReturnOrder; old: StoredReturn }> {
    const found = await tx.palletReturn.findUnique({
      where: { id: returnId },
      select: { orderId: true, order: { select: { customerId: true } } },
    });
    if (!found) throw new ApiError('RETURN_NOT_FOUND', { returnId });
    await lockCustomer(tx, found.order.customerId);
    await lockOrder(tx, found.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: found.orderId }, include: RETURN_ORDER_INCLUDE });
    const old = order.returns.find((pr) => pr.id === returnId);
    if (!old) throw new ApiError('RETURN_NOT_FOUND', { returnId });
    // First: a retry of a delete or edit that went through is told so, even if its order was cancelled since.
    if (old.reversedAt) throw new ApiError('RETURN_ALREADY_REVERSED', { returnId });
    if (order.cancelledAt) throw new ApiError('ORDER_CANCELLED', { orderId: order.id });
    return { order, old };
  }

  /** The items whose stock the entries may move, for the lines that belong to the order; the rest are refused later. */
  private itemIdsOf(order: ReturnOrder, entries: ReturnCreateBody['lines']): number[] {
    const itemOf = new Map(order.lines.map((line) => [line.id, line.itemId]));
    return entries.flatMap((entry) => {
      const itemId = itemOf.get(entry.orderLineId);
      return itemId !== undefined && entry.acceptedQuantity > 0 ? [itemId] : [];
    });
  }

  /** Each line with its price and the pallets still out in `state`. */
  private returnable(order: ReturnOrder, state: OrderState) {
    const totals = computeOrderTotals(state);
    return {
      date: dbDateToBusiness(order.date),
      lines: order.lines.map((line, index) => ({
        id: line.id,
        itemId: line.itemId,
        unitDeposit: toSafeMoney(line.unitDeposit),
        outQuantity: totals.lines[index]?.outQuantity ?? 0,
      })),
    };
  }

  /**
   * The order as it would stand had `returnId` been reversed, its standing refund reversed with it.
   * `toOrderState` keeps the loaded returns in their order, so a return's position is its index.
   */
  private stateWithout(order: ReturnOrder, returnId: number, refund: LedgerEntry | null): OrderState {
    const index = order.returns.findIndex((pr) => pr.id === returnId);
    return orderStateWithoutReturn(toOrderState(order), index, refund ? toSafeMoney(refund.amount) : 0);
  }

  /** The REFUND a return paid out, while it has not been reversed. */
  private standingRefund(order: ReturnOrder, returnId: number): LedgerEntry | null {
    return (
      order.ledgerEntries.find(
        (entry) => entry.type === 'REFUND' && entry.returnId === returnId && entry.reversedBy === null,
      ) ?? null
    );
  }

  private linesOf(pr: StoredReturn): PricedReturnLine[] {
    return pr.lines.map((line) => ({
      orderLineId: line.orderLineId,
      itemId: line.orderLine.itemId,
      acceptedQuantity: line.acceptedQuantity,
      damagedQuantity: line.damagedQuantity,
      unitDeposit: toSafeMoney(line.unitDeposit),
      damagedRefund: toSafeMoney(line.damagedRefund),
    }));
  }

  /** One movement per line with accepted pallets; damaged pallets never move stock (§4.7.1). */
  private accepted(
    lines: readonly PricedReturnLine[],
    reason: 'RETURN_ACCEPTED' | 'RETURN_EDIT' | 'RETURN_DELETE',
    orderId: number,
    returnId: number,
    sign: 1 | -1,
  ): StockMovementInput[] {
    return lines
      .filter((line) => line.acceptedQuantity > 0)
      .map((line) => ({ itemId: line.itemId, quantity: sign * line.acceptedQuantity, reason, orderId, returnId }));
  }

  private insertReturn(
    tx: Prisma.TransactionClient,
    orderId: number,
    body: ReturnCreateBody,
    lines: readonly PricedReturnLine[],
    money: { refundDue: number; owedBefore: number; cashRefund: number },
    userId: number,
  ) {
    return tx.palletReturn.create({
      data: {
        orderId,
        date: businessDateToDb(body.date),
        notes: body.notes ?? null,
        refundDue: toDbMoney(money.refundDue),
        owedBefore: toDbMoney(money.owedBefore),
        cashRefund: toDbMoney(money.cashRefund),
        createdByUserId: userId,
        lines: {
          create: lines.map((line) => ({
            orderLineId: line.orderLineId,
            acceptedQuantity: line.acceptedQuantity,
            damagedQuantity: line.damagedQuantity,
            unitDeposit: toDbMoney(line.unitDeposit),
            damagedRefund: toDbMoney(line.damagedRefund),
          })),
        },
      },
    });
  }

  /** The REFUND a return pays out when it credits more than was owed (§4.7.2); none when there is nothing to pay. */
  private refund(
    tx: Prisma.TransactionClient,
    orderId: number,
    returnId: number,
    source: 'RETURN_CREATE' | 'RETURN_EDIT',
    date: string,
    cashRefund: number,
    actor: AuthContext,
  ): Promise<LedgerEntry | null> {
    if (cashRefund === 0) return Promise.resolve(null);
    return this.money.record(tx, { orderId, type: 'REFUND', source, amount: cashRefund, date, returnId }, actor.userId);
  }

  private reverseRefund(
    tx: Prisma.TransactionClient,
    orderId: number,
    returnId: number,
    refund: LedgerEntry,
    source: 'RETURN_EDIT' | 'RETURN_DELETE',
    actor: AuthContext,
  ): Promise<LedgerEntry> {
    return this.money.record(
      tx,
      {
        orderId,
        type: 'REFUND_REVERSAL',
        source,
        amount: toSafeMoney(refund.amount),
        date: businessToday(this.clock.now()),
        returnId,
        reversesEntryId: refund.id,
      },
      actor.userId,
    );
  }

  private async snapshot(tx: Prisma.TransactionClient, returnId: number): Promise<Record<string, unknown>> {
    const pr = await tx.palletReturn.findUniqueOrThrow({
      where: { id: returnId },
      include: {
        lines: { orderBy: { id: 'asc' }, include: { orderLine: { include: { item: { select: { name: true } } } } } },
      },
    });
    return this.snapshotOf(pr);
  }

  /** §11.2: the return row with its lines; the lines name their item so the history can show it. */
  private snapshotOf(pr: StoredReturn): Record<string, unknown> {
    return {
      ...toAuditSnapshot('RETURN', pr),
      lines: pr.lines.map((line) => ({
        orderLineId: line.orderLineId,
        itemId: line.orderLine.itemId,
        itemName: line.orderLine.item.name,
        acceptedQuantity: line.acceptedQuantity,
        damagedQuantity: line.damagedQuantity,
        unitDeposit: toSafeMoney(line.unitDeposit),
        damagedRefund: toSafeMoney(line.damagedRefund),
      })),
    };
  }
}
