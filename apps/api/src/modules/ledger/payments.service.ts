import { Injectable } from '@nestjs/common';
import {
  businessToday,
  computeOrderTotals,
  dbDateToBusiness,
  type LedgerEntryReverseBody,
  type PaymentCreateBody,
  type PaymentResultDto,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertNotInFuture } from '../../common/utils/dates';
import { toSafeMoney } from '../../common/utils/money';
import { lockOrder } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { runInTransaction } from '../../prisma/transaction';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService, type IdempotentRequest, type IdempotentResult } from '../idempotency/idempotency.service';
import { ORDER_STATE_INCLUDE, recomputeOrder, toOrderState } from '../orders/order-state';
import { loadOrderDetail } from '../orders/orders.queries';
import { ledgerAuditEntry } from './ledger.mapper';
import { MoneyLedger } from './money-ledger';

/** Manual payments on credit orders, and their deletion as a reversing row (§4.8.7, §4.8.8, §6.21). */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly money: MoneyLedger,
  ) {}

  /** Once per idempotency key; a known key is answered before any check (§6.7). */
  create(
    orderId: number,
    body: PaymentCreateBody,
    actor: AuthContext,
    request: IdempotentRequest,
  ): Promise<IdempotentResult<PaymentResultDto>> {
    return this.idempotency.run(request, ({ store, replayIfStored }) => {
      assertNotInFuture(this.clock, body.date, 'date');
      return runInTransaction(this.prisma, async (tx) => {
        await lockOrder(tx, orderId);
        await replayIfStored(tx);
        const order = await tx.order.findUnique({ where: { id: orderId }, include: ORDER_STATE_INCLUDE });
        if (!order) throw new ApiError('ORDER_NOT_FOUND', { orderId });
        if (order.cancelledAt) throw new ApiError('ORDER_CANCELLED', { orderId });
        if (order.paymentType !== 'LENT')
          throw new ApiError('PAYMENT_ORDER_NOT_LENT', { paymentType: order.paymentType });
        const orderDate = dbDateToBusiness(order.date);
        if (body.date < orderDate) throw new ApiError('PAYMENT_DATE_BEFORE_ORDER_DATE', { orderDate });
        // Read from the rows under the lock, not the stored total: the cap is what the ledger says now.
        const { owed } = computeOrderTotals(toOrderState(order));
        if (body.amount > owed) throw new ApiError('PAYMENT_EXCEEDS_OWED', { owed, amount: body.amount });

        const entry = await this.money.record(
          tx,
          { orderId, type: 'PAYMENT', source: 'MANUAL', amount: body.amount, date: body.date, note: body.note ?? null },
          actor.userId,
        );
        await recomputeOrder(tx, orderId, { bumpVersion: true });
        await this.audit.record(tx, ledgerAuditEntry(entry, order.orderNumber));

        const result = { ledgerEntryId: entry.id, order: await loadOrderDetail(tx, orderId) };
        await store(tx, result);
        return result;
      });
    });
  }

  /** Deleting a manual payment: a PAYMENT_REVERSAL of the same amount, dated today (§4.8.8). */
  reverse(entryId: number, body: LedgerEntryReverseBody, actor: AuthContext): Promise<PaymentResultDto> {
    return runInTransaction(this.prisma, async (tx) => {
      const found = await tx.ledgerEntry.findUnique({ where: { id: entryId }, select: { orderId: true } });
      if (!found) throw new ApiError('LEDGER_ENTRY_NOT_FOUND', { ledgerEntryId: entryId });
      await lockOrder(tx, found.orderId);
      const entry = await tx.ledgerEntry.findUniqueOrThrow({
        where: { id: entryId },
        include: { reversedBy: { select: { id: true } }, order: { select: { orderNumber: true } } },
      });
      if (entry.type !== 'PAYMENT' || entry.source !== 'MANUAL') {
        throw new ApiError('LEDGER_ENTRY_NOT_REVERSIBLE', { type: entry.type, source: entry.source });
      }
      if (entry.reversedBy) throw new ApiError('LEDGER_ENTRY_ALREADY_REVERSED', { ledgerEntryId: entryId });

      const reversal = await this.money.record(
        tx,
        {
          orderId: entry.orderId,
          type: 'PAYMENT_REVERSAL',
          source: 'PAYMENT_DELETE',
          amount: toSafeMoney(entry.amount),
          date: businessToday(this.clock.now()),
          reversesEntryId: entry.id,
          note: body.note ?? null,
        },
        actor.userId,
      );
      await recomputeOrder(tx, entry.orderId, { bumpVersion: true });
      await this.audit.record(tx, ledgerAuditEntry(reversal, entry.order.orderNumber));
      return { ledgerEntryId: reversal.id, order: await loadOrderDetail(tx, entry.orderId) };
    });
  }
}
