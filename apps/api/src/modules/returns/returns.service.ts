import { Injectable } from '@nestjs/common';
import {
  businessDateToDb,
  businessToday,
  computeOrderTotals,
  dbDateToBusiness,
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
import { lockCustomer, lockItems, lockOrder } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { runInTransaction } from '../../prisma/transaction';
import { toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService, type IdempotentRequest, type IdempotentResult } from '../idempotency/idempotency.service';
import { ledgerAuditEntry } from '../ledger/ledger.mapper';
import { MoneyLedger } from '../ledger/money-ledger';
import { recomputeOrder, toOrderState } from '../orders/order-state';
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

        const priced = validateReturnAgainstOrder(this.returnable(order, toOrderState(order)), body);
        const money = priceReturn(priced, computeOrderTotals(toOrderState(order)).owed);
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
            accepted: priced.reduce((total, line) => total + line.acceptedQuantity, 0),
            damaged: priced.reduce((total, line) => total + line.damagedQuantity, 0),
            refundDue: money.refundDue,
            cashRefund: money.cashRefund,
          },
          after: await this.snapshot(tx, created.id),
        });
        if (refund) await this.audit.record(tx, ledgerAuditEntry(refund, order.orderNumber));

        const result = { returnId: created.id, order: await loadOrderDetail(tx, order.id) };
        await store(tx, result);
        return result;
      });
    });
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
