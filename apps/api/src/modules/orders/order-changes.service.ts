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
import { toDbMoney, toSafeMoney } from '../../common/utils/money';
import { assertVersion, changedFields } from '../../common/utils/versioning';
import type { LedgerEntry, Prisma } from '../../generated/prisma/client';
import { lockCustomer, lockItems, lockOrder } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { runInTransaction } from '../../prisma/transaction';
import { pickSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { ledgerAuditEntry } from '../ledger/ledger.mapper';
import { MoneyLedger } from '../ledger/money-ledger';
import { PalletCreditsService } from '../returns/pallet-credits.service';
import { StockLedger, type StockMovementInput } from '../stock/stock-ledger';
import { assertCreditAllows, type CreditOverride } from './credit-limit';
import { cancelledMark, lineCacheSeed, recomputeOrder } from './order-state';
import {
  ORDER_CHANGE_INCLUDE,
  assertDriverActive,
  assertItemOrderable,
  assertMayPriceAndOverride,
  depositTotalOf,
  priceLine,
  type PricedLine,
  assertNoActivity,
  orderActivity,
  standingAutomaticPayment,
  type ChangeableOrder,
} from './order-rules';
import { loadOrderDetail } from './orders.queries';

/** What a PATCH does to an order's lines, once compared with the stored ones by item. */
interface LineChange {
  kept: (PricedLine & { lineId: number })[];
  added: PricedLine[];
  removedLineIds: number[];
  /** Per item: the pallets coming back (positive) or going out (negative). */
  movements: { itemId: number; quantity: number }[];
  oldLines: PricedLine[];
  newLines: PricedLine[];
  oldDepositTotal: number;
  newDepositTotal: number;
}

/** What an order takes of the pallets owed, by item, for its history row (Q181). */
function creditList(taken: ReadonlyMap<number, number>): { itemId: number; quantity: number }[] {
  return [...taken].map(([itemId, quantity]) => ({ itemId, quantity })).sort((a, b) => a.itemId - b.itemId);
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
    private readonly credits: PalletCreditsService,
  ) {}

  update(orderId: number, body: OrderUpdateBody, actor: AuthContext): Promise<OrderDetailDto> {
    assertMayPriceAndOverride(body.lines ?? [], body.confirmCreditOverride, actor);
    if (body.date !== undefined) assertNotInFuture(this.clock, body.date, 'date');

    return runInTransaction(this.prisma, async (tx) => {
      // Pallets it took of what was owed (Q170) are locked with its lines, in one sorted pass (§6.6).
      const creditItems = body.lines ? await this.credits.orderCreditItemIds(tx, orderId) : [];
      const order = await this.lockChain(tx, orderId, {
        items: body.lines ? [...body.lines.map((line) => line.itemId), ...creditItems] : 'none',
      });
      assertVersion(order.version, body.version);
      // A page from before Q181 sends the lent pallets only: read as all that goes out, they would change the order.
      // It is answered as an order changed since, which every page already meets by reading it again (Q181).
      if (body.lines && !body.linesCountOwed) throw new ApiError('VERSION_CONFLICT', { currentVersion: order.version });
      if (order.cancelledAt) throw new ApiError('ORDER_CANCELLED', { orderId });
      const activity = orderActivity(order);

      const stored = { driverId: order.driverId, date: dbDateToBusiness(order.date), notes: order.notes };
      const fields = changedFields(body, stored, ['driverId', 'date', 'notes'] as const);
      if (fields.includes('driverId')) {
        const driverId = body.driverId as number;
        const driver = await tx.driver.findUnique({ where: { id: driverId }, select: { archivedAt: true } });
        assertDriverActive(driver, driverId);
      }
      if (fields.includes('date') && activity.earliestDate && (body.date as string) > activity.earliestDate) {
        throw new ApiError('ORDER_DATE_AFTER_ACTIVITY', { earliestActivityDate: activity.earliestDate });
      }

      if (body.lines) assertNoActivity(activity);
      // Q181: each requested quantity is all that goes out of its item, the pallets owed first; only the rest is lent.
      const split = body.lines
        ? await this.credits.planOrderEdit(tx, order, body.lines, businessToday(this.clock.now()))
        : null;
      if (split && body.lines) await this.assertMoreMayGoOut(tx, order, body.lines, split.before);
      const lines = split ? await this.diffLines(tx, order, split.lent) : null;
      const creditMovements = (split?.entries ?? []).map((entry) => ({
        itemId: entry.itemId,
        quantity: entry.quantity,
      }));
      const movements = [...(lines?.movements ?? []), ...creditMovements];
      // Q18/Q78: an archived customer's order may shrink, and its header may change, but no more
      // pallets go out to them — a line added, or a quantity raised, is a movement out.
      if (order.customer.archivedAt && movements.some((movement) => movement.quantity < 0)) {
        throw new ApiError('CUSTOMER_ARCHIVED', { customerId: order.customerId });
      }
      const creditChanged = (split?.entries.length ?? 0) > 0;
      // Q37: an edit that changes nothing writes nothing — no version bump, no history row.
      if (fields.length === 0 && lines === null && !creditChanged) return loadOrderDetail(tx, orderId);

      let override: CreditOverride | null = null;
      let reissued: { reversal: LedgerEntry | null; payment: LedgerEntry | null } = { reversal: null, payment: null };
      if (lines || creditChanged) {
        // The lent pallets and the owed ones in one stock check and one call, judged on the net (Q20).
        await this.stock.assertAvailable(tx, movements);
        const depositDelta = lines ? lines.newDepositTotal - lines.oldDepositTotal : 0;
        // A smaller order is always allowed; only a larger one meets the limit again (§4.4).
        if (depositDelta > 0) {
          override = await assertCreditAllows(tx, order.customer, depositDelta, body.confirmCreditOverride, actor);
        }
        const credited = await this.credits.insertMany(tx, split?.entries ?? [], actor);
        await this.applyLines(tx, order.id, lines, credited.movements, actor.userId);
        if (lines && order.paymentType === 'CASH') {
          reissued = await this.reissuePayment(tx, order, lines.newDepositTotal, actor);
        }
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
      if (split && body.lines) {
        // No edit may leave pallets out of a type the factory still owes this customer (Q170's one rule).
        const touched = new Set([...body.lines.map((line) => line.itemId), ...split.before.keys()]);
        await this.credits.assertNotOwedWhileOut(tx, order.customerId, [...touched]);
      }

      const changed: string[] = [...fields, ...(lines ? ['lines'] : []), ...(creditChanged ? ['fromCredit'] : [])];
      // The history names the items and the drivers, so a reader needs no ids (Q181).
      const named = await this.auditNames(tx, {
        itemIds:
          !lines && !creditChanged
            ? []
            : [
                ...[...order.lines, ...(split?.lent ?? [])].map((line) => line.itemId),
                ...(split ? [...split.before.keys(), ...split.after.keys()] : []),
              ],
        driverIds: fields.includes('driverId') ? [order.driverId, body.driverId as number] : [],
      });
      const before = {
        ...stored,
        driverName: named.driver(order.driverId),
        lines: lines && named.lines(lines.oldLines),
        fromCredit: split && named.lines(creditList(split.before)),
      };
      const after = {
        driverId: body.driverId ?? stored.driverId,
        driverName: named.driver(body.driverId ?? stored.driverId),
        date: body.date ?? stored.date,
        notes: body.notes === undefined ? stored.notes : body.notes,
        lines: lines && named.lines(lines.newLines),
        fromCredit: split && named.lines(creditList(split.after)),
      };
      const picked = [...changed, ...(fields.includes('driverId') ? ['driverName'] : [])];
      await this.audit.record(tx, {
        action: 'UPDATE',
        entityType: 'ORDER',
        entityId: String(order.id),
        summaryParams: { orderNumber: order.orderNumber, fields: changed },
        before: pickSnapshot(before, picked),
        after: pickSnapshot(after, picked),
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
      // The items it took of what was owed are locked with its own, in one sorted pass (§6.6, Q170): they are written
      // only under the customer's lock, which a cancel already racing this one holds, so reading them first is safe.
      const creditItems = await this.credits.orderCreditItemIds(tx, orderId);
      const order = await this.lockChain(tx, orderId, { items: creditItems });
      assertVersion(order.version, version);
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
      // What it took of the pallets the factory owed is owed again (Q170) — as before the order, whatever the customer
      // was lent since: a cancel puts back what was, so it is never refused for that.
      await this.credits.reverseForOrder(tx, order, businessToday(this.clock.now()), actor);
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
        data: cancelledMark(this.clock.now(), actor.userId),
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
   * customer never changes — then the order, then items: `'none'` when the request does not touch
   * lines, `'own'` for the items of the order's lines, or a list of requested item ids, locked together
   * with the order's own.
   */
  private async lockChain(
    tx: Prisma.TransactionClient,
    orderId: number,
    { items }: { items: 'none' | 'own' | number[] },
  ): Promise<ChangeableOrder> {
    const found = await tx.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
    if (!found) throw new ApiError('ORDER_NOT_FOUND', { orderId });
    await lockCustomer(tx, found.customerId);
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_CHANGE_INCLUDE });
    if (items !== 'none') {
      await lockItems(tx, [...order.lines.map((line) => line.itemId), ...(items === 'own' ? [] : items)]);
    }
    return order;
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
    const added: PricedLine[] = [];
    let changed = false;
    const newLines = requested.map((line, index) => {
      const old = stored.get(line.itemId);
      if (old) {
        // An archived item may stay on the order, or go down, but no more of it can go out.
        if (old.item.archivedAt && line.quantity > old.quantity) {
          throw new ApiError('ITEM_ARCHIVED', { itemId: line.itemId });
        }
        const row = priceLine(line, toSafeMoney(old.unitDeposit), index);
        if (row.quantity !== old.quantity || row.unitDeposit !== toSafeMoney(old.unitDeposit)) {
          changed = true;
          kept.push({ ...row, lineId: old.id });
        }
        return row;
      }
      const item = newItems.get(line.itemId);
      assertItemOrderable(item, line.itemId);
      const row = priceLine(line, toSafeMoney(item.depositPrice), index);
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
    const newDepositTotal = depositTotalOf(newLines);
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

  /**
   * Writes the new line set and its ORDER_LINE_EDIT movements, with the movements of what the order now takes of the
   * pallets owed (Q181) in the same stock call; `out_quantity` is recomputed after.
   */
  private async applyLines(
    tx: Prisma.TransactionClient,
    orderId: number,
    lines: LineChange | null,
    creditMovements: StockMovementInput[],
    userId: number,
  ) {
    if (!lines) {
      await this.stock.apply(tx, creditMovements, userId);
      return;
    }
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
          ...lineCacheSeed(line.quantity),
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
          ...lineCacheSeed(line.quantity),
        })),
      });
    }
    await this.stock.apply(
      tx,
      [
        ...lines.movements.map((movement) => ({ ...movement, reason: 'ORDER_LINE_EDIT' as const, orderId })),
        ...creditMovements,
      ],
      userId,
    );
  }

  /** The names an order's history row gives its items and drivers (Q181). */
  private async auditNames(
    tx: Prisma.TransactionClient,
    { itemIds, driverIds }: { itemIds: number[]; driverIds: number[] },
  ) {
    const [items, drivers] = await Promise.all([
      itemIds.length > 0
        ? tx.item.findMany({ where: { id: { in: [...new Set(itemIds)] } }, select: { id: true, name: true } })
        : [],
      driverIds.length > 0
        ? tx.driver.findMany({ where: { id: { in: [...new Set(driverIds)] } }, select: { id: true, name: true } })
        : [],
    ]);
    const itemName = new Map(items.map((item) => [item.id, item.name]));
    const driverName = new Map(drivers.map((driver) => [driver.id, driver.name]));
    return {
      lines: <T extends { itemId: number }>(rows: readonly T[]) =>
        rows.map((row) => ({ ...row, itemName: itemName.get(row.itemId) ?? null })),
      driver: (driverId: number) => driverName.get(driverId) ?? null,
    };
  }

  /**
   * An item whose pallets out on the order go up must still be orderable (Q181): what is owed going out counts too, so
   * an archived or unknown item is refused as a new line's is.
   */
  private async assertMoreMayGoOut(
    tx: Prisma.TransactionClient,
    order: ChangeableOrder,
    requested: NonNullable<OrderUpdateBody['lines']>,
    usedBefore: ReadonlyMap<number, number>,
  ): Promise<void> {
    const lent = new Map(order.lines.map((line) => [line.itemId, line.quantity]));
    const more = requested
      .filter((line) => line.quantity > (lent.get(line.itemId) ?? 0) + (usedBefore.get(line.itemId) ?? 0))
      .map((line) => line.itemId);
    if (more.length === 0) return;
    const items = new Map(
      (await tx.item.findMany({ where: { id: { in: more } }, select: { id: true, archivedAt: true } })).map((item) => [
        item.id,
        item,
      ]),
    );
    for (const itemId of more) assertItemOrderable(items.get(itemId), itemId);
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
              // With the old payment reversed, the new deposit is all that is owed (Q137).
              owedBefore: newDepositTotal,
            },
            actor.userId,
          )
        : null;
    return { reversal, payment };
  }
}
