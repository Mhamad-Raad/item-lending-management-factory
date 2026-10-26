import { Injectable } from '@nestjs/common';
import {
  businessDateToDb,
  businessToday,
  dbDateToBusiness,
  formatOrderNumber,
  type HandBackReceiptDto,
  type HandBackResultDto,
  type PalletCreditBalanceDto,
  type PalletCreditHandBackBody,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertNotInFuture } from '../../common/utils/dates';
import type { PalletCredit, PalletCreditReason, Prisma } from '../../generated/prisma/client';
import { lockCustomer, lockItems } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { runInTransaction } from '../../prisma/transaction';
import { toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService, type IdempotentRequest, type IdempotentResult } from '../idempotency/idempotency.service';
import { ITEM_REF_INCLUDE, toItemRef } from '../items/items.mapper';
import { openOutByItem } from '../orders/open-out';
import { loadReceiptFactory } from '../settings/receipt-factory';
import { StockLedger, type StockMovementInput } from '../stock/stock-ledger';
import { USER_REF_SELECT, toUserRef } from '../users/users.mapper';

/** One entry of what is owed, as written (`writeMany`). */
interface CreditEntry {
  customerId: number;
  itemId: number;
  quantity: number;
  reason: PalletCreditReason;
  returnId?: number;
  orderId?: number;
  reversesCreditId?: number;
  date: string;
  note?: string | null;
}

/** A return's standing surplus of an item (`surplusOf`). */
export interface SurplusRow {
  returnId: number;
  itemId: number;
  quantity: number;
}

/**
 * Q170: what the factory owes a customer of each pallet type — pallets that came back beyond what they had out, less
 * what was given back. Append-only: each entry is mirrored by a stock movement of its own sign, and a correction is a
 * reversing entry. The balance is never below zero.
 */
@Injectable()
export class PalletCreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly stock: StockLedger,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * What the factory owes the customer of each item — of the items named, or of all — summed over the ledger: the one
   * reading of the balance (Q170). Items owed nothing, or never, are absent.
   */
  async owedByItem(
    client: Prisma.TransactionClient,
    customerId: number,
    itemIds?: readonly number[],
  ): Promise<Map<number, number>> {
    const rows = await client.palletCredit.groupBy({
      by: ['itemId'],
      where: { customerId, ...(itemIds ? { itemId: { in: [...new Set(itemIds)] } } : {}) },
      _sum: { quantity: true },
    });
    return new Map(rows.flatMap((row) => ((row._sum.quantity ?? 0) > 0 ? [[row.itemId, row._sum.quantity ?? 0]] : [])));
  }

  /** What the factory owes the customer now, by pallet type; types owed nothing are left out. */
  async balances(
    customerId: number,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<PalletCreditBalanceDto[]> {
    const owed = await this.owedByItem(client, customerId);
    if (owed.size === 0) return [];
    const items = await client.item.findMany({
      where: { id: { in: [...owed.keys()] } },
      ...ITEM_REF_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return items.map((item) => ({ item: toItemRef(item), quantity: owed.get(item.id) ?? 0 }));
  }

  /** The balance of one item for the customer, inside a transaction holding the customer's lock. */
  async balanceOf(tx: Prisma.TransactionClient, customerId: number, itemId: number): Promise<number> {
    return (await this.owedByItem(tx, customerId, [itemId])).get(itemId) ?? 0;
  }

  /** Writes one entry and its stock movement (`writeMany`). */
  async write(tx: Prisma.TransactionClient, entry: CreditEntry, actor: AuthContext) {
    const [created] = await this.writeMany(tx, [entry], actor);
    if (!created) throw new Error('A pallet credit entry was not written');
    return created;
  }

  /**
   * Writes entries and their stock movements, the movements in one `StockLedger.apply` so the stock check judges the
   * net of them (Q20): a surplus moved from one return to another moves no pallet. The caller holds the customer's
   * lock and the items' (§6.6), and has checked that what goes out leaves the balance at zero or more.
   */
  async writeMany(tx: Prisma.TransactionClient, entries: readonly CreditEntry[], actor: AuthContext) {
    const { created, movements } = await this.insertMany(tx, entries, actor);
    await this.stock.apply(tx, movements, actor.userId);
    return created;
  }

  /**
   * Writes entries and gives back their stock movements unapplied, for a caller that judges them in one stock call
   * with movements of its own — an edited return's pallets (Q174).
   */
  async insertMany(
    tx: Prisma.TransactionClient,
    entries: readonly CreditEntry[],
    actor: AuthContext,
  ): Promise<{ created: PalletCredit[]; movements: StockMovementInput[] }> {
    if (entries.length === 0) return { created: [], movements: [] };
    const created = await tx.palletCredit.createManyAndReturn({
      data: entries.map((entry) => ({
        customerId: entry.customerId,
        itemId: entry.itemId,
        quantity: entry.quantity,
        reason: entry.reason,
        returnId: entry.returnId ?? null,
        orderId: entry.orderId ?? null,
        reversesCreditId: entry.reversesCreditId ?? null,
        date: businessDateToDb(entry.date),
        note: entry.note ?? null,
        createdByUserId: actor.userId,
      })),
    });
    const movements = created.map((row) => ({
      itemId: row.itemId,
      quantity: row.quantity,
      reason: 'PALLET_CREDIT' as const,
      palletCreditId: row.id,
    }));
    return { created, movements };
  }

  /**
   * The one rule of what is owed (Q170): pallets of a type are owed only while the customer has none of it out. Checked
   * after anything that can put pallets out again on an order of theirs — a return deleted or corrected, an order
   * cancelled or edited —, which is refused while the factory still owes them pallets of that type.
   */
  async assertNotOwedWhileOut(
    tx: Prisma.TransactionClient,
    customerId: number,
    itemIds: readonly number[],
  ): Promise<void> {
    if (itemIds.length === 0) return;
    const owing = await this.owedByItem(tx, customerId, itemIds);
    if (owing.size === 0) return;
    const out = await openOutByItem(tx, customerId, [...owing.keys()]);
    for (const [itemId, owed] of owing) {
      const outQuantity = out.get(itemId) ?? 0;
      if (outQuantity > 0) throw new ApiError('PALLET_CREDIT_OUTSTANDING', { itemId, owed, outQuantity });
    }
  }

  /**
   * What a new order takes of the pallets the factory owes the customer (Q170), item by item: as many as it hands over,
   * up to what is owed. Read under the customer's lock.
   */
  async planOrderUse(
    tx: Prisma.TransactionClient,
    customerId: number,
    lines: readonly { itemId: number; quantity: number }[],
  ): Promise<Map<number, number>> {
    const balance = await this.owedByItem(
      tx,
      customerId,
      lines.map((line) => line.itemId),
    );
    const use = new Map<number, number>();
    for (const line of lines) {
      const available = balance.get(line.itemId) ?? 0;
      if (available > 0) use.set(line.itemId, Math.min(available, line.quantity));
    }
    return use;
  }

  /** Writes a new order's use of what was owed (`planOrderUse`); the caller holds the items' locks. */
  async useForOrder(
    tx: Prisma.TransactionClient,
    customerId: number,
    orderId: number,
    use: Map<number, number>,
    date: string,
    actor: AuthContext,
  ): Promise<void> {
    await this.writeMany(
      tx,
      [...use].flatMap(([itemId, quantity]) =>
        quantity > 0 ? [{ customerId, itemId, quantity: -quantity, reason: 'ORDER_USE' as const, orderId, date }] : [],
      ),
      actor,
    );
  }

  /** The items an order took of what was owed, to lock with its own before it is cancelled (§6.6, Q170). */
  async orderCreditItemIds(tx: Prisma.TransactionClient, orderId: number): Promise<number[]> {
    const rows = await tx.palletCredit.findMany({ where: { orderId }, select: { itemId: true }, distinct: ['itemId'] });
    return rows.map((row) => row.itemId);
  }

  /**
   * A cancelled order's use of what was owed is owed again (Q170). The caller holds the customer's lock and the items'
   * (`orderCreditItemIds`, locked with the order's own in one sorted pass).
   */
  async reverseForOrder(
    tx: Prisma.TransactionClient,
    order: { id: number; customerId: number },
    date: string,
    actor: AuthContext,
    /** Only these items — an edit that took them off the order (Q170); all of them on a cancel. */
    itemIds?: readonly number[],
  ): Promise<void> {
    const rows = await tx.palletCredit.groupBy({
      by: ['itemId'],
      where: { orderId: order.id, ...(itemIds ? { itemId: { in: [...itemIds] } } : {}) },
      _sum: { quantity: true },
    });
    await this.writeMany(
      tx,
      rows
        .filter((row) => (row._sum.quantity ?? 0) < 0)
        .map((row) => ({
          customerId: order.customerId,
          itemId: row.itemId,
          quantity: -(row._sum.quantity ?? 0),
          reason: 'ORDER_CANCEL' as const,
          orderId: order.id,
          date,
        })),
      actor,
    );
  }

  /** The visit of the return a correction replaced, however many corrections back; null when it had none. */
  private async visitBehind(tx: Prisma.TransactionClient, returnId: number): Promise<number | null> {
    let current = returnId;
    for (let depth = 0; depth < 50; depth += 1) {
      const earlier = await tx.palletReturn.findFirst({
        where: { replacedByReturnId: current },
        select: { id: true, customerReturnId: true },
      });
      if (!earlier) return null;
      if (earlier.customerReturnId !== null) return earlier.customerReturnId;
      current = earlier.id;
    }
    return null;
  }

  /**
   * A visit's returns and every correction of them since: a correction belongs to no visit (Q161), but the surplus it
   * carried over (`carryOverForReplace`) is still the visit's.
   */
  private async visitReturnIds(tx: Prisma.TransactionClient, customerReturnId: number): Promise<number[]> {
    const ids = (await tx.palletReturn.findMany({ where: { customerReturnId }, select: { id: true } })).map(
      (row) => row.id,
    );
    let frontier = ids;
    for (let depth = 0; frontier.length > 0 && depth < 50; depth += 1) {
      const next = await tx.palletReturn.findMany({
        where: { id: { in: frontier }, replacedByReturnId: { not: null } },
        select: { replacedByReturnId: true },
      });
      frontier = next.flatMap((row) => (row.replacedByReturnId === null ? [] : [row.replacedByReturnId]));
      ids.push(...frontier);
    }
    return ids;
  }

  /**
   * The surplus a return being corrected or deleted takes back (Q170): its own, and — for a return of a customer's
   * return over several orders — the visit's surplus of the items it took back, since that surplus was counted over all
   * of the visit's returns and stands on one of them only.
   */
  async surplusOf(
    tx: Prisma.TransactionClient,
    pr: { id: number; customerReturnId: number | null; itemIds: readonly number[] },
  ): Promise<SurplusRow[]> {
    // A correction belongs to no visit (Q161), but one of a visit's return still does for its surplus: found back
    // through what it replaced.
    const customerReturnId = pr.customerReturnId ?? (await this.visitBehind(tx, pr.id));
    const where: Prisma.PalletCreditWhereInput =
      customerReturnId === null
        ? { returnId: pr.id }
        : {
            OR: [
              { returnId: pr.id },
              { returnId: { in: await this.visitReturnIds(tx, customerReturnId) }, itemId: { in: [...pr.itemIds] } },
            ],
          };
    const rows = await tx.palletCredit.groupBy({ by: ['returnId', 'itemId'], where, _sum: { quantity: true } });
    return rows.flatMap((row) =>
      row.returnId !== null && (row._sum.quantity ?? 0) > 0
        ? [{ returnId: row.returnId, itemId: row.itemId, quantity: row._sum.quantity ?? 0 }]
        : [],
    );
  }

  /**
   * Of a return's surplus (`surplusOf`), what is still owed (Q174): the part given back or taken by an order since,
   * oldest surplus first, stays where it is, so an edit from the returns list reopens only the rest.
   */
  async standingSurplus(
    tx: Prisma.TransactionClient,
    customerId: number,
    surplus: readonly SurplusRow[],
  ): Promise<SurplusRow[]> {
    const remainingOf = new Map<number, Map<number, number>>();
    for (const itemId of new Set(surplus.map((row) => row.itemId))) {
      remainingOf.set(itemId, await this.remainingByReturn(tx, customerId, itemId));
    }
    return surplus.flatMap((row) => {
      const quantity = Math.min(row.quantity, remainingOf.get(row.itemId)?.get(row.returnId) ?? 0);
      return quantity > 0 ? [{ ...row, quantity }] : [];
    });
  }

  /**
   * What is left of each return's surplus of an item after what went out of it — given back, or taken by an order —
   * oldest surplus first. A surplus reversed since counts for nothing.
   */
  private async remainingByReturn(
    tx: Prisma.TransactionClient,
    customerId: number,
    itemId: number,
  ): Promise<Map<number, number>> {
    const rows = await tx.palletCredit.findMany({
      where: { customerId, itemId },
      orderBy: { id: 'asc' },
      select: { id: true, quantity: true, returnId: true },
    });
    const surplus = new Map<number, number>();
    const firstRow = new Map<number, number>();
    let used = 0;
    for (const row of rows) {
      if (row.returnId === null) {
        used -= row.quantity;
        continue;
      }
      surplus.set(row.returnId, (surplus.get(row.returnId) ?? 0) + row.quantity);
      if (!firstRow.has(row.returnId)) firstRow.set(row.returnId, row.id);
    }
    // A surplus moved to a correction keeps its place: the corrected return's, oldest of its chain (`carryOverForReplace`).
    const replaced = await tx.palletReturn.findMany({
      where: { replacedByReturnId: { in: [...surplus.keys()] } },
      select: { id: true, replacedByReturnId: true },
    });
    const place = (returnId: number, seen = 0): number => {
      const earlier = replaced.find((row) => row.replacedByReturnId === returnId);
      const own = firstRow.get(returnId) ?? Number.MAX_SAFE_INTEGER;
      return earlier && seen < 50 ? Math.min(own, place(earlier.id, seen + 1)) : own;
    };
    const ordered = [...surplus].sort(([a], [b]) => place(a) - place(b));
    const remaining = new Map<number, number>();
    for (const [returnId, quantity] of ordered) {
      const taken = Math.min(Math.max(used, 0), quantity);
      used -= taken;
      remaining.set(returnId, quantity - taken);
    }
    return remaining;
  }

  /**
   * A return being deleted takes its surplus back (Q170), `surplusOf`, under the customer's lock and its items'
   * (`creditedItemIds`). Refused when any of that surplus has gone out since — given back or taken by an order, the
   * oldest surplus going out first —, so a later return's credit is never spent on it.
   */
  async reverseForReturn(
    tx: Prisma.TransactionClient,
    pr: { id: number; customerId: number },
    surplus: readonly SurplusRow[],
    date: string,
    actor: AuthContext,
  ): Promise<void> {
    // One reading of each item's history, however many returns' surplus of it is taken back.
    const remainingOf = new Map<number, Map<number, number>>();
    for (const row of surplus) {
      let byReturn = remainingOf.get(row.itemId);
      if (!byReturn) {
        byReturn = await this.remainingByReturn(tx, pr.customerId, row.itemId);
        remainingOf.set(row.itemId, byReturn);
      }
      const remaining = byReturn.get(row.returnId) ?? 0;
      if (remaining < row.quantity) {
        throw new ApiError('PALLET_CREDIT_GIVEN_BACK', { returnId: pr.id, itemId: row.itemId, available: remaining });
      }
      await this.write(
        tx,
        {
          customerId: pr.customerId,
          itemId: row.itemId,
          quantity: -row.quantity,
          reason: 'RETURN_REVERSAL',
          returnId: row.returnId,
          date,
        },
        actor,
      );
    }
  }

  /**
   * A return corrected on its order's form keeps its surplus (Q170): it moves to the replacement, the factory owing
   * the same pallets. Refused when the correction leaves pallets of that type out again on any open order, since the
   * surplus was owed only once all of them were back; a surplus a visit keeps on another order's return stays there.
   */
  async carryOverForReplace(
    tx: Prisma.TransactionClient,
    old: { id: number; customerId: number },
    surplus: readonly SurplusRow[],
    replacementId: number,
    date: string,
    actor: AuthContext,
  ): Promise<void> {
    const out = await openOutByItem(
      tx,
      old.customerId,
      surplus.map((row) => row.itemId),
    );
    for (const row of surplus) {
      const outQuantity = out.get(row.itemId) ?? 0;
      if (outQuantity > 0) throw new ApiError('PALLET_SURPLUS_STILL_OUT', { itemId: row.itemId, outQuantity });
    }
    const base = (row: SurplusRow) => ({ customerId: old.customerId, itemId: row.itemId, date });
    await this.writeMany(
      tx,
      surplus
        .filter((row) => row.returnId === old.id)
        .flatMap((row) => [
          { ...base(row), quantity: -row.quantity, reason: 'RETURN_REVERSAL' as const, returnId: old.id },
          { ...base(row), quantity: row.quantity, reason: 'RETURN_SURPLUS' as const, returnId: replacementId },
        ]),
      actor,
    );
  }

  /**
   * Pallets the factory owed, handed back to the customer (Q170): one entry, its stock out, one history row. Once per
   * idempotency key (§6.7); a known key is answered before any check.
   */
  handBack(
    customerId: number,
    body: PalletCreditHandBackBody,
    actor: AuthContext,
    request: IdempotentRequest,
  ): Promise<IdempotentResult<HandBackResultDto>> {
    return this.idempotency.run(request, ({ store, replayIfStored }) => {
      assertNotInFuture(this.clock, body.date, 'date');
      return runInTransaction(this.prisma, async (tx) => {
        await lockCustomer(tx, customerId);
        await replayIfStored(tx);
        const customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (!customer) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId });
        await lockItems(tx, [body.itemId]);
        const item = await tx.item.findUnique({ where: { id: body.itemId } });
        if (!item) throw new ApiError('ITEM_NOT_FOUND', { itemId: body.itemId });
        const available = await this.balanceOf(tx, customerId, body.itemId);
        if (available < body.quantity) {
          throw new ApiError('PALLET_CREDIT_INSUFFICIENT', { itemId: body.itemId, available });
        }
        const created = await this.write(
          tx,
          {
            customerId,
            itemId: body.itemId,
            quantity: -body.quantity,
            reason: 'HAND_BACK',
            date: body.date,
            note: body.note,
          },
          actor,
        );
        await this.audit.record(tx, {
          action: 'HAND_BACK',
          entityType: 'PALLET_CREDIT',
          entityId: String(created.id),
          summaryParams: { customerName: customer.name, itemName: item.name, quantity: body.quantity },
          after: toAuditSnapshot('PALLET_CREDIT', created),
        });
        // The page reads what is owed again itself: the answer only names the entry, for its paper (Q172).
        const result = { palletCreditId: created.id };
        await store(tx, result);
        return result;
      });
    });
  }

  /**
   * A give-back's paper (Q172): its type and count, and what was owed of that type just before and after it — the sum
   * of the entries before it, so a reprint says what the original said. Only a give-back has one.
   */
  async handBackReceipt(palletCreditId: number): Promise<HandBackReceiptDto> {
    const entry = await this.prisma.palletCredit.findUnique({
      where: { id: palletCreditId },
      include: {
        item: { select: { name: true } },
        customer: true,
        createdBy: USER_REF_SELECT,
        reversedBy: { select: { date: true } },
      },
    });
    if (!entry || entry.reason !== 'HAND_BACK') throw new ApiError('HAND_BACK_NOT_FOUND', { palletCreditId });
    const [before, factory] = await Promise.all([
      this.prisma.palletCredit.aggregate({
        where: { customerId: entry.customerId, itemId: entry.itemId, id: { lt: entry.id } },
        _sum: { quantity: true },
      }),
      loadReceiptFactory(this.prisma),
    ]);
    const owedBefore = before._sum.quantity ?? 0;
    return {
      palletCreditId: entry.id,
      // Its own run, given by the database as it was written: never shared or swapped by two at once.
      receiptNumberDisplay: formatOrderNumber(entry.handBackNumber ?? 0),
      date: dbDateToBusiness(entry.date),
      printedOn: businessToday(this.clock.now()),
      itemName: entry.item.name,
      quantity: -entry.quantity,
      owedBefore,
      owedAfter: owedBefore + entry.quantity,
      note: entry.note,
      recordedBy: toUserRef(entry.createdBy),
      reversedOn: entry.reversedBy ? dbDateToBusiness(entry.reversedBy.date) : null,
      factory,
      customer: { name: entry.customer.name, phone: entry.customer.phone, address: entry.customer.address },
    };
  }

  /**
   * A give-back recorded by mistake, undone (Q173): what it gave back is owed again and comes back into stock, by an
   * entry naming it, once — undoing it again changes nothing. Refused while the customer has that type out. Its paper
   * is stamped from then on.
   */
  async undoHandBack(palletCreditId: number, actor: AuthContext): Promise<void> {
    await runInTransaction(this.prisma, async (tx) => {
      const found = await tx.palletCredit.findUnique({
        where: { id: palletCreditId },
        select: { customerId: true, itemId: true, reason: true },
      });
      if (!found || found.reason !== 'HAND_BACK') throw new ApiError('HAND_BACK_NOT_FOUND', { palletCreditId });
      await lockCustomer(tx, found.customerId);
      await lockItems(tx, [found.itemId]);
      const entry = await tx.palletCredit.findUniqueOrThrow({
        where: { id: palletCreditId },
        include: { reversedBy: { select: { id: true } }, customer: true, item: { select: { name: true } } },
      });
      // Undone already — a retry after a lost answer, or two people at once: the undo stands, and that is the answer.
      if (entry.reversedBy) return;
      // Owed again only while the customer holds none of that type (Q170's one rule): pallets taken since come back
      // first, or the undo would leave what is owed beside what they hold.
      const outQuantity = (await openOutByItem(tx, entry.customerId, [entry.itemId])).get(entry.itemId) ?? 0;
      if (outQuantity > 0) throw new ApiError('HAND_BACK_UNDO_WHILE_OUT', { itemId: entry.itemId, outQuantity });
      const created = await this.write(
        tx,
        {
          customerId: entry.customerId,
          itemId: entry.itemId,
          quantity: -entry.quantity,
          reason: 'HAND_BACK_REVERSAL',
          reversesCreditId: entry.id,
          date: businessToday(this.clock.now()),
        },
        actor,
      );
      await this.audit.record(tx, {
        action: 'HAND_BACK_REVERSE',
        entityType: 'PALLET_CREDIT',
        entityId: String(entry.id),
        summaryParams: { customerName: entry.customer.name, itemName: entry.item.name, quantity: -entry.quantity },
        before: toAuditSnapshot('PALLET_CREDIT', entry),
        after: toAuditSnapshot('PALLET_CREDIT', created),
      });
    });
  }
}
