import { Injectable } from '@nestjs/common';
import {
  businessDateToDb,
  businessToday,
  dbDateToBusiness,
  type OrderDetailDto,
  type OrderUpdateBody,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertNotInFuture } from '../../common/utils/dates';
import { safeProduct, toDbMoney, toSafeMoney } from '../../common/utils/money';
import type { LedgerEntry, Prisma } from '../../generated/prisma/client';
import { lockCustomer, lockItems, lockOrder } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { runInTransaction } from '../../prisma/transaction';
import { pickSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { ledgerAuditEntry } from '../ledger/ledger.mapper';
import { MoneyLedger } from '../ledger/money-ledger';
import { StockLedger } from '../stock/stock-ledger';
import { assertCreditAllows, type CreditOverride } from './credit-limit';
import { recomputeOrder } from './order-state';
import {
  ORDER_CHANGE_INCLUDE,
  assertMayPriceAndOverride,
  assertNoActivity,
  orderActivity,
  standingAutomaticPayment,
  type ChangeableOrder,
} from './order-rules';
import { loadOrderDetail } from './orders.queries';

interface LineRow {
  itemId: number;
  quantity: number;
  unitDeposit: number;
  lineTotal: number;
}

/** What a PATCH does to an order's lines, once compared with the stored ones by item. */
interface LineChange {
  kept: (LineRow & { lineId: number })[];
  added: LineRow[];
  removedLineIds: number[];
  /** Per item: the pallets coming back (positive) or going out (negative). */
  movements: { itemId: number; quantity: number }[];
  oldLines: LineRow[];
  newLines: LineRow[];
  oldDepositTotal: number;
  newDepositTotal: number;
}

/** Order edit and cancel (§4.8.2, §4.8.3, §6.19): changes to an order after its hand-over. */
@Injectable()
export class OrderChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly stock: StockLedger,
    private readonly money: MoneyLedger,
  ) {}

  update(orderId: number, body: OrderUpdateBody, actor: AuthContext): Promise<OrderDetailDto> {
    assertMayPriceAndOverride(body.lines ?? [], body.confirmCreditOverride, actor);
    if (body.date !== undefined) assertNotInFuture(this.clock, body.date, 'date');

    return runInTransaction(this.prisma, async (tx) => {
      const order = await this.lockChain(tx, orderId, body.lines?.map((line) => line.itemId) ?? null);
      if (order.version !== body.version) throw new ApiError('VERSION_CONFLICT', { currentVersion: order.version });
      if (order.cancelledAt) throw new ApiError('ORDER_CANCELLED', { orderId });
      const activity = orderActivity(order);

      const stored = { driverId: order.driverId, date: dbDateToBusiness(order.date), notes: order.notes };
      const fields = (['driverId', 'date', 'notes'] as const).filter(
        (field) => body[field] !== undefined && body[field] !== stored[field],
      );
      if (fields.includes('driverId')) await this.assertDriverActive(tx, body.driverId as number);
      if (fields.includes('date') && activity.earliestDate && (body.date as string) > activity.earliestDate) {
        throw new ApiError('ORDER_DATE_AFTER_ACTIVITY', { earliestActivityDate: activity.earliestDate });
      }

      if (body.lines) assertNoActivity(activity);
      const lines = body.lines ? await this.diffLines(tx, order, body.lines) : null;
      // Q37: an edit that changes nothing writes nothing — no version bump, no history row.
      if (fields.length === 0 && lines === null) return loadOrderDetail(tx, orderId);

      let override: CreditOverride | null = null;
      let reissued: { reversal: LedgerEntry | null; payment: LedgerEntry | null } = { reversal: null, payment: null };
      if (lines) {
        await this.stock.assertAvailable(tx, lines.movements);
        const depositDelta = lines.newDepositTotal - lines.oldDepositTotal;
        // A smaller order is always allowed; only a larger one meets the limit again (§4.4).
        if (depositDelta > 0) {
          override = await assertCreditAllows(tx, order.customer, depositDelta, body.confirmCreditOverride, actor);
        }
        await this.applyLines(tx, order.id, lines, actor.userId);
        if (order.paymentType === 'CASH') reissued = await this.reissuePayment(tx, order, lines.newDepositTotal, actor);
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          driverId: fields.includes('driverId') ? body.driverId : undefined,
          date: fields.includes('date') ? businessDateToDb(body.date as string) : undefined,
          notes: fields.includes('notes') ? body.notes : undefined,
          // A later override on a line edit takes the place of the earlier one (§4.4).
          ...(override ? { creditOverrideByUserId: actor.userId, creditOverrideAt: this.clock.now() } : {}),
        },
      });
      await recomputeOrder(tx, order.id, { bumpVersion: true });

      const changed: string[] = [...fields, ...(lines ? ['lines'] : [])];
      const before = { ...stored, lines: lines?.oldLines };
      const after = {
        driverId: body.driverId ?? stored.driverId,
        date: body.date ?? stored.date,
        notes: body.notes === undefined ? stored.notes : body.notes,
        lines: lines?.newLines,
      };
      await this.audit.record(tx, {
        action: 'UPDATE',
        entityType: 'ORDER',
        entityId: String(order.id),
        summaryParams: { orderNumber: order.orderNumber, fields: changed },
        before: pickSnapshot(before, changed),
        after: pickSnapshot(after, changed),
      });
      for (const entry of [reissued.reversal, reissued.payment]) {
        if (entry) await this.audit.record(tx, ledgerAuditEntry(entry, order.orderNumber));
      }
      if (override) {
        await this.audit.record(tx, {
          action: 'CREDIT_OVERRIDE',
          entityType: 'ORDER',
          entityId: String(order.id),
          summaryParams: { orderNumber: order.orderNumber, customerName: order.customer.name, excess: override.excess },
          after: override,
        });
      }
      return loadOrderDetail(tx, order.id);
    });
  }

  /** A cancelled order keeps its number; its pallets come back and a cash payment is reversed (§4.8.3). */
  cancel(orderId: number, version: number, actor: AuthContext): Promise<OrderDetailDto> {
    return runInTransaction(this.prisma, async (tx) => {
      const order = await this.lockChain(tx, orderId, []);
      if (order.version !== version) throw new ApiError('VERSION_CONFLICT', { currentVersion: order.version });
      if (order.cancelledAt) throw new ApiError('ORDER_CANCELLED', { orderId });
      assertNoActivity(orderActivity(order));

      await this.stock.apply(
        tx,
        order.lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          reason: 'ORDER_CANCEL' as const,
          orderId: order.id,
        })),
        actor.userId,
      );
      const payment = standingAutomaticPayment(order);
      const reversal = payment
        ? await this.money.record(
            tx,
            {
              orderId: order.id,
              type: 'PAYMENT_REVERSAL',
              source: 'ORDER_CANCEL',
              amount: toSafeMoney(payment.amount),
              date: businessToday(this.clock.now()),
              reversesEntryId: payment.id,
            },
            actor.userId,
          )
        : null;

      await tx.order.update({
        where: { id: order.id },
        // The status goes with the timestamp: the table checks that one never stands without the other.
        data: { cancelledAt: this.clock.now(), cancelledByUserId: actor.userId, status: 'CANCELLED' },
      });
      await recomputeOrder(tx, order.id, { bumpVersion: true });

      await this.audit.record(tx, {
        action: 'CANCEL',
        entityType: 'ORDER',
        entityId: String(order.id),
        summaryParams: { orderNumber: order.orderNumber, customerName: order.customer.name },
      });
      if (reversal) await this.audit.record(tx, ledgerAuditEntry(reversal, order.orderNumber));
      return loadOrderDetail(tx, order.id);
    });
  }

  /**
   * Takes the order's locks in the global order (§6.6): its customer — read unlocked, as an order's
   * customer never changes — then the order, then the items of its lines and of `newItemIds`.
   * `newItemIds` null means the request does not touch lines, and no item is locked.
   */
  private async lockChain(
    tx: Prisma.TransactionClient,
    orderId: number,
    newItemIds: number[] | null,
  ): Promise<ChangeableOrder> {
    const found = await tx.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
    if (!found) throw new ApiError('ORDER_NOT_FOUND', { orderId });
    await lockCustomer(tx, found.customerId);
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_CHANGE_INCLUDE });
    if (newItemIds !== null) await lockItems(tx, [...order.lines.map((line) => line.itemId), ...newItemIds]);
    return order;
  }

  private async assertDriverActive(tx: Prisma.TransactionClient, driverId: number): Promise<void> {
    const driver = await tx.driver.findUnique({ where: { id: driverId }, select: { archivedAt: true } });
    if (!driver) throw new ApiError('DRIVER_NOT_FOUND', { driverId });
    if (driver.archivedAt) throw new ApiError('DRIVER_ARCHIVED', { driverId });
  }

  /**
   * Compares the requested line set with the stored one by item (§6.19 step 6). Null when they are
   * the same: then nothing moves and no payment is re-issued.
   */
  private async diffLines(
    tx: Prisma.TransactionClient,
    order: ChangeableOrder,
    requested: NonNullable<OrderUpdateBody['lines']>,
  ): Promise<LineChange | null> {
    const stored = new Map(order.lines.map((line) => [line.itemId, line]));
    const newIds = requested.map((line) => line.itemId).filter((itemId) => !stored.has(itemId));
    const newItems = new Map(
      (await tx.item.findMany({ where: { id: { in: newIds } } })).map((item) => [item.id, item]),
    );

    const kept: LineChange['kept'] = [];
    const added: LineRow[] = [];
    let changed = false;
    const newLines = requested.map((line, index) => {
      const old = stored.get(line.itemId);
      if (old) {
        const unitDeposit = line.unitDeposit ?? toSafeMoney(old.unitDeposit);
        // An archived item may stay on the order, or go down, but no more of it can go out.
        if (old.item.archivedAt && line.quantity > old.quantity) {
          throw new ApiError('ITEM_ARCHIVED', { itemId: line.itemId });
        }
        const row = {
          itemId: line.itemId,
          quantity: line.quantity,
          unitDeposit,
          lineTotal: safeProduct(line.quantity, unitDeposit, `lines.${index}.unitDeposit`),
        };
        if (row.quantity !== old.quantity || unitDeposit !== toSafeMoney(old.unitDeposit)) {
          changed = true;
          kept.push({ ...row, lineId: old.id });
        }
        return row;
      }
      const item = newItems.get(line.itemId);
      if (!item) throw new ApiError('ITEM_NOT_FOUND', { itemId: line.itemId });
      if (item.archivedAt) throw new ApiError('ITEM_ARCHIVED', { itemId: line.itemId });
      const unitDeposit = line.unitDeposit ?? toSafeMoney(item.depositPrice);
      const row = {
        itemId: line.itemId,
        quantity: line.quantity,
        unitDeposit,
        lineTotal: safeProduct(line.quantity, unitDeposit, `lines.${index}.unitDeposit`),
      };
      changed = true;
      added.push(row);
      return row;
    });

    const requestedIds = new Set(requested.map((line) => line.itemId));
    const removed = order.lines.filter((line) => !requestedIds.has(line.itemId));
    // A reversed return does not freeze the lines, but its rows stay forever and point at their line:
    // such a line may shrink, never go (Q40).
    const withReturns = await tx.returnLine.findFirst({
      where: { orderLineId: { in: removed.map((line) => line.id) } },
      select: { orderLine: { select: { itemId: true } } },
    });
    if (withReturns) throw new ApiError('ORDER_LINE_HAS_RETURNS', { itemId: withReturns.orderLine.itemId });
    if (!changed && removed.length === 0) return null;

    const oldQuantity = new Map(order.lines.map((line) => [line.itemId, line.quantity]));
    const newQuantity = new Map(newLines.map((line) => [line.itemId, line.quantity]));
    const movements = [...new Set([...oldQuantity.keys(), ...newQuantity.keys()])]
      .map((itemId) => ({ itemId, quantity: (oldQuantity.get(itemId) ?? 0) - (newQuantity.get(itemId) ?? 0) }))
      .filter((movement) => movement.quantity !== 0);

    const oldLines = order.lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      unitDeposit: toSafeMoney(line.unitDeposit),
      lineTotal: toSafeMoney(line.lineTotal),
    }));
    const newDepositTotal = newLines.reduce((total, line) => total + line.lineTotal, 0);
    if (!Number.isSafeInteger(newDepositTotal)) {
      throw new ApiError('VALIDATION_FAILED', undefined, [
        { path: 'lines', code: 'too_big', params: { maximum: Number.MAX_SAFE_INTEGER } },
      ]);
    }
    return {
      kept,
      added,
      removedLineIds: removed.map((line) => line.id),
      movements,
      oldLines,
      newLines,
      oldDepositTotal: toSafeMoney(order.depositTotal),
      newDepositTotal,
    };
  }

  /** Writes the new line set and its ORDER_LINE_EDIT movements; `out_quantity` is recomputed after. */
  private async applyLines(tx: Prisma.TransactionClient, orderId: number, lines: LineChange, userId: number) {
    if (lines.removedLineIds.length > 0) {
      await tx.orderLine.deleteMany({ where: { id: { in: lines.removedLineIds } } });
    }
    for (const line of lines.kept) {
      await tx.orderLine.update({
        where: { id: line.lineId },
        data: {
          quantity: line.quantity,
          unitDeposit: toDbMoney(line.unitDeposit),
          lineTotal: toDbMoney(line.lineTotal),
          outQuantity: line.quantity,
        },
      });
    }
    if (lines.added.length > 0) {
      await tx.orderLine.createMany({
        data: lines.added.map((line) => ({
          orderId,
          itemId: line.itemId,
          quantity: line.quantity,
          unitDeposit: toDbMoney(line.unitDeposit),
          lineTotal: toDbMoney(line.lineTotal),
          outQuantity: line.quantity,
        })),
      });
    }
    await this.stock.apply(
      tx,
      lines.movements.map((movement) => ({ ...movement, reason: 'ORDER_LINE_EDIT' as const, orderId })),
      userId,
    );
  }

  /**
   * A cash order's lines changed, so its payment no longer matches its deposit (§4.7.2): the standing
   * automatic payment is reversed and a new one issued for the new total. Each step is skipped only
   * when its amount would be 0; the pair is written even when the total did not change.
   */
  private async reissuePayment(
    tx: Prisma.TransactionClient,
    order: ChangeableOrder,
    newDepositTotal: number,
    actor: AuthContext,
  ): Promise<{ reversal: LedgerEntry | null; payment: LedgerEntry | null }> {
    const standing = standingAutomaticPayment(order);
    const reversal = standing
      ? await this.money.record(
          tx,
          {
            orderId: order.id,
            type: 'PAYMENT_REVERSAL',
            source: 'ORDER_LINE_EDIT',
            amount: toSafeMoney(standing.amount),
            date: businessToday(this.clock.now()),
            reversesEntryId: standing.id,
          },
          actor.userId,
        )
      : null;
    const payment =
      newDepositTotal > 0
        ? await this.money.record(
            tx,
            {
              orderId: order.id,
              type: 'PAYMENT',
              source: 'ORDER_LINE_EDIT',
              amount: newDepositTotal,
              date: null,
              isAutomatic: true,
            },
            actor.userId,
          )
        : null;
    return { reversal, payment };
  }
}
