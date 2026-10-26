import { Injectable } from '@nestjs/common';
import {
  businessDateToDb,
  businessToday,
  computeOrderTotals,
  dbDateToBusiness,
  type CustomerReturnCreateBody,
  type CustomerReturnEditableDto,
  type CustomerReturnReplaceBody,
  type CustomerReturnRecordedDto,
  type CustomerReturnResultDto,
  type CustomerReturnableDto,
  type ErrorDetails,
  type OrderState,
  type PageDto,
  type ReturnCreateBody,
  type ReturnListItemDto,
  type ReturnListQuery,
  type ReturnResultDto,
  orderStateWithoutReturn,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertDateRange, assertNotInFuture, businessDateFilter } from '../../common/utils/dates';
import { pageArgs, toPage } from '../../common/utils/pagination';
import { parseSort } from '../../common/utils/sort';
import { toDbMoney, toSafeMoney } from '../../common/utils/money';
import type { LedgerEntry, Prisma } from '../../generated/prisma/client';
import { lockCustomer, lockItems, lockOrder, lockOrders } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { runInSnapshot, runInTransaction } from '../../prisma/transaction';
import { toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService, type IdempotentRequest, type IdempotentResult } from '../idempotency/idempotency.service';
import { ledgerAuditEntry } from '../ledger/ledger.mapper';
import { MoneyLedger } from '../ledger/money-ledger';
import { toCustomerRef } from '../customers/customers.mapper';
import { ITEM_REF_INCLUDE, toItemRef } from '../items/items.mapper';
import { recomputeOrder, toOrderState } from '../orders/order-state';
import { toOrderLineDto } from '../orders/orders.mapper';
import { loadOrderDetail } from '../orders/orders.queries';
import { openOutByItem } from '../orders/open-out';
import { orderSearch } from '../orders/order-search';
import { USER_REF_SELECT, toUserRef } from '../users/users.mapper';
import { StockLedger, type StockMovementInput } from '../stock/stock-ledger';
import { PalletCreditsService, type SurplusRow } from './pallet-credits.service';
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

/** An open order as the customer screen lists it (Q156), its figures as they stand or as an edit sees them (Q174). */
function toReturnableOrder(
  order: {
    id: number;
    orderNumber: number;
    date: Date;
    paymentType: CustomerReturnableDto['orders'][number]['paymentType'];
  },
  owed: number,
  outQuantityTotal: number,
  lines: CustomerReturnableDto['orders'][number]['lines'],
): CustomerReturnableDto['orders'][number] {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    date: dbDateToBusiness(order.date),
    paymentType: order.paymentType,
    owed,
    outQuantityTotal,
    lines,
  };
}

/** The pallets a return takes back, good and damaged. */
function countsOf(priced: readonly PricedReturnLine[]): { accepted: number; damaged: number } {
  return {
    accepted: priced.reduce((total, line) => total + line.acceptedQuantity, 0),
    damaged: priced.reduce((total, line) => total + line.damagedQuantity, 0),
  };
}

/** A visit's figures over its orders' returns, as its history row says them (Q161). */
function visitFigures(returns: readonly CustomerReturnRecordedDto[]) {
  const total = (pick: (entry: CustomerReturnRecordedDto) => number) =>
    returns.reduce((sum, entry) => sum + pick(entry), 0);
  return {
    orders: returns.length,
    accepted: total((entry) => entry.accepted),
    damaged: total((entry) => entry.damaged),
    refundDue: total((entry) => entry.refundDue),
    cashRefund: total((entry) => entry.cashRefund),
  };
}

const LIST_SORT_FIELDS = { id: 'id', date: 'date', refundDue: 'refundDue', cashRefund: 'cashRefund' } as const;

/** A row of the returns list (Q168): its order and customer, its lines' counts, its standing refund. */
const RETURN_LIST_INCLUDE = {
  order: { select: { id: true, orderNumber: true, customer: true } },
  lines: { select: { acceptedQuantity: true, damagedQuantity: true } },
  ledgerEntries: { where: { type: 'REFUND', reversedBy: null }, select: { id: true } },
  createdBy: USER_REF_SELECT,
} as const satisfies Prisma.PalletReturnInclude;

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
    private readonly credits: PalletCreditsService,
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
  /** The returns list (Q168), newest first by default: one page, with the total. */
  async list(query: ReturnListQuery): Promise<PageDto<ReturnListItemDto>> {
    assertDateRange(query.dateFrom, query.dateTo);
    // Each filter is its own condition, AND-ed: the search names customers through `order` too, and spread into one
    // object it would replace the customer filter instead of narrowing it.
    const where: Prisma.PalletReturnWhereInput = {
      AND: [
        query.customerId ? { order: { customerId: query.customerId } } : {},
        query.orderId ? { orderId: query.orderId } : {},
        query.itemId ? { lines: { some: { orderLine: { itemId: query.itemId } } } } : {},
        { date: businessDateFilter(query.dateFrom, query.dateTo) },
        query.q ? await this.searchFilter(query.q) : {},
      ],
    };
    const { field, direction } = parseSort<keyof typeof LIST_SORT_FIELDS>(query.sort);
    const orderBy: Prisma.PalletReturnOrderByWithRelationInput[] =
      field === 'id' ? [{ id: direction }] : [{ [LIST_SORT_FIELDS[field]]: direction }, { id: direction }];
    const [total, rows] = await Promise.all([
      this.prisma.palletReturn.count({ where }),
      this.prisma.palletReturn.findMany({ where, include: RETURN_LIST_INCLUDE, orderBy, ...pageArgs(query) }),
    ]);
    return toPage(
      rows.map((pr) => ({
        id: pr.id,
        date: dbDateToBusiness(pr.date),
        orderId: pr.order.id,
        orderNumber: pr.order.orderNumber,
        customer: toCustomerRef(pr.order.customer),
        accepted: pr.lines.reduce((total, line) => total + line.acceptedQuantity, 0),
        damaged: pr.lines.reduce((total, line) => total + line.damagedQuantity, 0),
        refundDue: toSafeMoney(pr.refundDue),
        cashRefund: toSafeMoney(pr.cashRefund),
        reversed: pr.reversedAt !== null,
        refundEntryId: pr.ledgerEntries[0]?.id ?? null,
        customerReturnId: pr.customerReturnId,
        createdAt: pr.createdAt.toISOString(),
        createdBy: toUserRef(pr.createdBy),
      })),
      query,
      total,
    );
  }

  /** The search box, as the orders list's (§6.19, `orderSearch`): that order number, or the customers named. */
  private async searchFilter(q: string): Promise<Prisma.PalletReturnWhereInput> {
    const { customerIds, orderNumber } = await orderSearch(this.prisma, q);
    const byCustomerName: Prisma.PalletReturnWhereInput = { order: { customerId: { in: customerIds } } };
    return orderNumber === null ? byCustomerName : { OR: [{ order: { orderNumber } }, byCustomerName] };
  }

  /** A customer's pallets still out, on their open orders, oldest order first (Q156). */
  async returnableFor(
    customerId: number,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<CustomerReturnableDto> {
    // Pallets are out only on an OPEN order (Q150): `orders (customer_id, status)` narrows to those.
    const [customer, orders] = await Promise.all([
      client.customer.findUnique({ where: { id: customerId } }),
      client.order.findMany({
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
      orders: orders.map((order) =>
        toReturnableOrder(order, toSafeMoney(order.owed), order.outQuantityTotal, order.lines.map(toOrderLineDto)),
      ),
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

        const ids = body.orders.map((entry) => entry.orderId);
        await this.assertOwnOrders(tx, customerId, ids);
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
        await this.checkSurplus(tx, customerId, checked, body.surplus);

        // Over two orders or more, one visit with one receipt and one history row, each order's return pointing to it
        // (Q161). A return on one order is that order's own, as if recorded there: its receipt names the order.
        const visit =
          checked.length > 1
            ? await tx.customerReturn.create({
                data: { customerId, date: businessDateToDb(body.date), createdByUserId: actor.userId },
              })
            : null;
        const returns: CustomerReturnRecordedDto[] = [];
        const snapshots: Record<string, unknown>[] = [];
        for (const { order, body: one, priced, money } of checked.sort(
          (a, b) => a.order.orderNumber - b.order.orderNumber,
        )) {
          const { snapshot, refund, ...written } = await this.write(
            tx,
            order,
            one,
            priced,
            money,
            actor,
            visit?.id ?? null,
          );
          returns.push({
            ...written,
            orderId: order.id,
            orderNumber: order.orderNumber,
            refundDue: money.refundDue,
            owedBefore: money.owedBefore,
            cashRefund: money.cashRefund,
            owedAfter: money.owedAfter,
          });
          // Its refund's own ledger row in full, since the visit's row stands in for the refund's history row too.
          const refundSnapshot = refund ? toAuditSnapshot('LEDGER_ENTRY', refund) : null;
          snapshots.push({ orderNumber: order.orderNumber, ...snapshot, refund: refundSnapshot });
        }
        // Pallets beyond what was out (Q170), each on the return of the latest order it came back on.
        const { surplus, movements } = await this.writeSurplus(tx, customer, body, checked, returns, actor);
        // One stock call for all of them (Q20).
        await this.stock.apply(tx, movements, actor.userId);
        if (visit) {
          await this.audit.record(tx, {
            action: 'RETURN_CREATE',
            entityType: 'CUSTOMER_RETURN',
            entityId: String(visit.id),
            summaryParams: { customerName: customer.name, ...visitFigures(returns) },
            after: {
              ...toAuditSnapshot('CUSTOMER_RETURN', visit),
              returns: snapshots,
            },
          });
        }

        const result = { customerReturnId: visit?.id ?? null, customer: toCustomerRef(customer), returns, surplus };
        await store(tx, result);
        return result;
      });
    });
  }

  /**
   * Pallets beyond what was out (Q170) are taken only of an item that comes back in this return and that the customer
   * then has out on no order at all: what they still hold elsewhere comes back first. The customer's lock keeps their
   * orders as they are while this is read.
   */
  private async checkSurplus(
    tx: Prisma.TransactionClient,
    customerId: number,
    checked: { priced: PricedReturnLine[] }[],
    surplus: CustomerReturnCreateBody['surplus'],
  ): Promise<void> {
    if (surplus.length === 0) return;
    const outOf = await openOutByItem(
      tx,
      customerId,
      surplus.map((extra) => extra.itemId),
    );
    for (const extra of surplus) {
      const returned = checked
        .flatMap(({ priced }) => priced)
        .filter((line) => line.itemId === extra.itemId)
        .reduce((total, line) => total + line.acceptedQuantity + line.damagedQuantity, 0);
      if (returned === 0) throw new ApiError('PALLET_SURPLUS_NOT_RETURNED', { itemId: extra.itemId });
      const outQuantity = (outOf.get(extra.itemId) ?? 0) - returned;
      if (outQuantity > 0) {
        throw new ApiError('PALLET_SURPLUS_STILL_OUT', { itemId: extra.itemId, outQuantity });
      }
    }
  }

  /**
   * The return to edit from the returns list (Q174): its customer's pallets as if it — for a visit, every standing part
   * of it — had never been recorded, and what it took back by item, its extra pallets in the accepted count, so the
   * customer screen starts from it exactly as it was typed.
   */
  editableFor(returnId: number): Promise<CustomerReturnEditableDto> {
    // One moment for every read, so the orders, the counts and the cash shown agree with each other.
    return runInSnapshot(this.prisma, async (tx) => {
      const target = await tx.palletReturn.findUnique({
        where: { id: returnId },
        select: {
          id: true,
          customerReturnId: true,
          reversedAt: true,
          date: true,
          notes: true,
          order: { select: { customerId: true } },
        },
      });
      if (!target) throw new ApiError('RETURN_NOT_FOUND', { returnId });
      if (target.reversedAt) throw new ApiError('RETURN_ALREADY_REVERSED', { returnId });
      const customerId = target.order.customerId;
      const oldIds = (await this.partsOf(tx, target)).map((part) => part.id);
      const base = await this.returnableFor(customerId, tx);
      const oldOrders = await tx.order.findMany({
        where: { returns: { some: { id: { in: oldIds } } } },
        include: { ...RETURN_ORDER_INCLUDE, lines: { orderBy: { id: 'asc' }, include: { item: ITEM_REF_INCLUDE } } },
        orderBy: { orderNumber: 'asc' },
      });
      // A return on a cancelled order can never be saved again: said at once, not after the counts are typed.
      const cancelled = oldOrders.find((order) => order.cancelledAt !== null);
      if (cancelled) throw new ApiError('ORDER_CANCELLED', { orderId: cancelled.id });
      // Each order's old part and the refund it paid, found once.
      const parts = oldOrders.flatMap((order) => {
        const old = order.returns.find((pr) => oldIds.includes(pr.id));
        return old ? [{ order, old, refund: this.standingRefund(order, old.id) }] : [];
      });
      // Only what is still owed of its extra pallets comes back into the count (Q174): any given out since stay out.
      const surplus = await this.credits.standingSurplus(
        tx,
        customerId,
        await this.credits.surplusOf(tx, {
          id: target.id,
          customerReturnId: target.customerReturnId,
          itemIds: [...new Set(parts.flatMap(({ old }) => old.lines.map((line) => line.orderLine.itemId)))],
        }),
      );
      const rebuilt = parts.map(({ order, old, refund }) => {
        const totals = computeOrderTotals(this.stateWithout(order, old.id, refund));
        const lines = order.lines.map((line, index) => ({
          ...toOrderLineDto(line),
          returnedAccepted: totals.lines[index]?.returnedAccepted ?? 0,
          returnedDamaged: totals.lines[index]?.returnedDamaged ?? 0,
          outQuantity: totals.lines[index]?.outQuantity ?? 0,
        }));
        return toReturnableOrder(
          order,
          totals.owed,
          totals.outQuantityTotal,
          lines.filter((line) => line.outQuantity > 0),
        );
      });
      const rebuiltIds = new Set(rebuilt.map((order) => order.id));
      const items = new Map<number, { itemId: number; accepted: number; damaged: number; damagedRefund: number }>();
      const lines: CustomerReturnEditableDto['lines'] = [];
      for (const { old } of parts) {
        for (const line of old.lines) {
          lines.push({
            orderLineId: line.orderLineId,
            accepted: line.acceptedQuantity,
            damaged: line.damagedQuantity,
            damagedRefund: toSafeMoney(line.damagedRefund),
          });
          const itemId = line.orderLine.itemId;
          const row = items.get(itemId) ?? { itemId, accepted: 0, damaged: 0, damagedRefund: 0 };
          row.accepted += line.acceptedQuantity;
          row.damaged += line.damagedQuantity;
          row.damagedRefund += toSafeMoney(line.damagedRefund);
          items.set(itemId, row);
        }
      }
      for (const row of surplus) {
        const entry = items.get(row.itemId);
        if (entry) entry.accepted += row.quantity;
      }
      return {
        customer: base.customer,
        orders: [...base.orders.filter((order) => !rebuiltIds.has(order.id)), ...rebuilt]
          .filter((order) => order.lines.length > 0)
          .sort((a, b) => a.orderNumber - b.orderNumber),
        returnId: target.id,
        customerReturnId: target.customerReturnId,
        date: dbDateToBusiness(target.date),
        notes: target.notes,
        reopened: surplus.map((row) => ({ itemId: row.itemId, quantity: row.quantity })),
        cashRefunded: parts.reduce((total, { refund }) => total + (refund ? toSafeMoney(refund.amount) : 0), 0),
        items: [...items.values()],
        lines,
      };
    });
  }

  /**
   * The orders named are the customer's: another customer's is refused as not found — whatever its state — and never
   * locked under the wrong customer (§6.6). An order's customer never changes, so this is read before any is locked.
   */
  private async assertOwnOrders(tx: Prisma.TransactionClient, customerId: number, ids: readonly number[]) {
    const owners = new Map(
      (await tx.order.findMany({ where: { id: { in: [...ids] } }, select: { id: true, customerId: true } })).map(
        (row) => [row.id, row.customerId],
      ),
    );
    const foreign = ids.find((id) => owners.get(id) !== customerId);
    if (foreign !== undefined) throw new ApiError('ORDER_NOT_FOUND', { orderId: foreign });
  }

  /** A return and, for a visit, its other standing parts (Q161): edited as the one return they were (Q174). */
  private async partsOf(
    client: Prisma.TransactionClient,
    target: { id: number; customerReturnId: number | null },
  ): Promise<{ id: number; orderId: number }[]> {
    return client.palletReturn.findMany({
      where:
        target.customerReturnId === null
          ? { id: target.id }
          : { customerReturnId: target.customerReturnId, reversedAt: null },
      select: { id: true, orderId: true },
    });
  }

  /**
   * A return edited from the returns list (Q174), as it is recorded on the customer screen: in one transaction its
   * standing parts are replaced by what the screen now says — a part whose order still takes pallets back is corrected
   * (`EDIT`, pointing to its replacement), a part whose order takes none now is deleted, an order newly named gets a
   * return of its own — each checked and priced against its order without the old part, exactly as `replace`. Over two
   * orders or more the new returns are one visit again (Q161). Its extra pallets still owed are taken back and the
   * screen's written anew (Q170); those given out since stay where they are, and a save is refused when more went out
   * after the screen opened than it knew of (`reopened`). Not idempotent: a repeat finds the old return reversed.
   */
  replaceForCustomer(
    returnId: number,
    body: CustomerReturnReplaceBody,
    actor: AuthContext,
  ): Promise<CustomerReturnResultDto> {
    assertNotInFuture(this.clock, body.date, 'date');
    return runInTransaction(this.prisma, async (tx) => {
      const found = await tx.palletReturn.findUnique({
        where: { id: returnId },
        select: { id: true, customerReturnId: true, order: { select: { customerId: true } } },
      });
      if (!found) throw new ApiError('RETURN_NOT_FOUND', { returnId });
      const customerId = found.order.customerId;
      await lockCustomer(tx, customerId);
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      const target = await tx.palletReturn.findUniqueOrThrow({
        where: { id: returnId },
        select: { id: true, customerReturnId: true, reversedAt: true, orderId: true },
      });
      if (target.reversedAt) throw new ApiError('RETURN_ALREADY_REVERSED', { returnId });
      const parts = await this.partsOf(tx, target);
      const oldIds = parts.map((part) => part.id);
      const oldOrderIds = parts.map((part) => part.orderId);

      // The orders named must be this customer's, refused as not found otherwise, before any is locked (§6.6).
      const named = body.orders.map((entry) => entry.orderId);
      await this.assertOwnOrders(tx, customerId, named);
      const ids = [...new Set([...oldOrderIds, ...named])];
      await lockOrders(tx, ids);
      const loaded = await tx.order.findMany({ where: { id: { in: ids } }, include: RETURN_ORDER_INCLUDE });
      for (const order of loaded) {
        if (order.cancelledAt) throw new ApiError('ORDER_CANCELLED', { orderId: order.id });
      }

      const olds = loaded.flatMap((order) => order.returns.filter((pr) => oldIds.includes(pr.id)));
      const oldItemIds = olds.flatMap((pr) => pr.lines.map((line) => line.orderLine.itemId));
      // Only what is still owed of its extra pallets is taken back and written anew (Q174), as the screen showed it;
      // any given back or taken by an order since stays where it is, so no balance can end below zero.
      const surplusRows = await this.credits.standingSurplus(
        tx,
        customerId,
        await this.credits.surplusOf(tx, {
          id: target.id,
          customerReturnId: target.customerReturnId,
          itemIds: oldItemIds,
        }),
      );
      // What the screen counted as still owed must still be: pallets of it given back or taken by an order since the
      // screen opened would otherwise be written again (Q174).
      for (const itemId of new Set([...surplusRows, ...body.reopened].map((row) => row.itemId))) {
        const sum = (rows: readonly { itemId: number; quantity: number }[]) =>
          rows.filter((row) => row.itemId === itemId).reduce((total, row) => total + row.quantity, 0);
        if (sum(surplusRows) !== sum(body.reopened)) {
          throw new ApiError('PALLET_CREDIT_GIVEN_BACK', { returnId, itemId, available: sum(surplusRows) });
        }
      }
      await lockItems(tx, [
        ...oldItemIds,
        ...loaded.flatMap((order) =>
          this.itemIdsOf(order, body.orders.find((entry) => entry.orderId === order.id)?.lines ?? []),
        ),
        ...surplusRows.map((row) => row.itemId),
        ...body.surplus.map((extra) => extra.itemId),
      ]);

      // Every order checked against itself without its old part before anything is written.
      const over: ErrorDetails<'RETURN_EXCEEDS_OUT'>['lines'] = [];
      type Plan = {
        order: ReturnOrder;
        old: StoredReturn | null;
        standingRefund: LedgerEntry | null;
        one: {
          date: string;
          notes: CustomerReturnCreateBody['notes'];
          lines: CustomerReturnCreateBody['orders'][number]['lines'];
        };
        checked: { priced: PricedReturnLine[]; money: ReturnType<typeof priceReturn> } | null;
      };
      const plans = loaded
        .sort((a, b) => a.orderNumber - b.orderNumber)
        .flatMap((order): Plan[] => {
          const old = order.returns.find((pr) => oldIds.includes(pr.id)) ?? null;
          const standingRefund = old ? this.standingRefund(order, old.id) : null;
          const state = old ? this.stateWithout(order, old.id, standingRefund) : toOrderState(order);
          const lines = body.orders.find((entry) => entry.orderId === order.id)?.lines ?? [];
          const one = { date: body.date, notes: body.notes, lines };
          if (lines.length === 0) return old ? [{ order, old, standingRefund, one, checked: null }] : [];
          try {
            const priced = validateReturnAgainstOrder(this.returnable(order, state), one);
            const money = priceReturn(priced, computeOrderTotals(state).owed);
            return [{ order, old, standingRefund, one, checked: { priced, money } }];
          } catch (error) {
            if (!(error instanceof ApiError) || error.code !== 'RETURN_EXCEEDS_OUT') throw error;
            over.push(...(error.details as ErrorDetails<'RETURN_EXCEEDS_OUT'>).lines);
            return [];
          }
        });
      if (over.length > 0) {
        throw new ApiError('RETURN_EXCEEDS_OUT', { lines: over } satisfies ErrorDetails<'RETURN_EXCEEDS_OUT'>);
      }
      const kept = plans.flatMap(({ order, checked }) => (checked ? [{ order, priced: checked.priced }] : []));
      if (kept.length === 0) throw new ApiError('RETURN_EMPTY');
      // An order the return was on that takes nothing back now loses its part: a deletion, which is its own right
      // (§7.4.2), as on the order's page.
      if (plans.some(({ old, checked }) => old && !checked) && !actor.permissions.has('returns.delete')) {
        throw new ApiError('PERMISSION_DENIED', { required: ['returns.delete'] });
      }
      // An order newly named gets a return of its own: a recording, its own right (`returns.edit` asks for it too).
      if (plans.some(({ old, checked }) => !old && checked) && !actor.permissions.has('returns.create')) {
        throw new ApiError('PERMISSION_DENIED', { required: ['returns.create'] });
      }
      // An extra only of an item this return takes back, as when recording (`checkSurplus`); whether any of that type
      // is still out is judged on the database as the edit leaves it, below.
      for (const extra of body.surplus) {
        if (!kept.some(({ priced }) => priced.some((line) => line.itemId === extra.itemId))) {
          throw new ApiError('PALLET_SURPLUS_NOT_RETURNED', { itemId: extra.itemId });
        }
      }

      // A return over several orders, before or after, keeps one history row (Q161): the parts' own rows are left to
      // it, as when it was recorded.
      const visit =
        kept.length > 1
          ? await tx.customerReturn.create({
              data: { customerId, date: businessDateToDb(body.date), createdByUserId: actor.userId },
            })
          : null;
      // History (Q161): a return over several orders, before or after, has one row for the edit, holding its parts and
      // refunds. A return that was on one order still gets its own row — corrected or deleted — so its history says so;
      // a return newly made on an order and the refunds are in the edit's row once it is over several orders.
      const oldGrouped = target.customerReturnId !== null;
      const grouped = visit !== null || oldGrouped;
      const returns: CustomerReturnRecordedDto[] = [];
      const before: Record<string, unknown>[] = [];
      const after: Record<string, unknown>[] = [];
      // Every order's pallets out and in, and the extra pallets, through one stock call after the loop, so an item is
      // judged on its net over the whole edit (Q20): a part deleted on one order never runs stock short of what another
      // takes back, nor pallets turned damaged of the extra they become.
      const movements: StockMovementInput[] = [];
      for (const { order, old, standingRefund, one, checked } of plans) {
        const reversedAt = this.clock.now();
        if (old) before.push({ orderNumber: order.orderNumber, ...this.snapshotOf(old) });
        if (!checked) {
          // Its order takes nothing back now: the old part is deleted, as on the order's page.
          if (!old) continue;
          movements.push(...this.accepted(this.linesOf(old), 'RETURN_DELETE', order.id, old.id, -1));
          const reversal = standingRefund
            ? await this.reverseRefund(tx, order.id, old.id, standingRefund, 'RETURN_DELETE', actor)
            : null;
          await tx.palletReturn.update({
            where: { id: old.id },
            data: { reversedAt, reversedByUserId: actor.userId, reversalKind: 'DELETE' },
          });
          await recomputeOrder(tx, order.id, { bumpVersion: true });
          if (grouped) {
            after.push({
              orderNumber: order.orderNumber,
              deletedReturnId: old.id,
              refundReversal: reversal ? toAuditSnapshot('LEDGER_ENTRY', reversal) : null,
            });
          }
          if (!oldGrouped) {
            await this.audit.record(tx, {
              action: 'RETURN_DELETE',
              entityType: 'RETURN',
              entityId: String(old.id),
              summaryParams: { orderNumber: order.orderNumber },
              before: this.snapshotOf(old),
              after: { reversedAt: reversedAt.toISOString(), reversalKind: 'DELETE' },
            });
          }
          if (!grouped && reversal) await this.audit.record(tx, ledgerAuditEntry(reversal, order.orderNumber));
          continue;
        }
        const { priced, money } = checked;
        const created = await this.insertReturn(tx, order.id, one, priced, money, actor.userId, visit?.id ?? null);
        movements.push(
          ...(old ? this.accepted(this.linesOf(old), 'RETURN_EDIT', order.id, old.id, -1) : []),
          ...this.accepted(priced, 'RETURN_ACCEPTED', order.id, created.id, 1),
        );
        const reversal =
          old && standingRefund
            ? await this.reverseRefund(tx, order.id, old.id, standingRefund, 'RETURN_EDIT', actor)
            : null;
        const refund = await this.refund(
          tx,
          order.id,
          created.id,
          old ? 'RETURN_EDIT' : 'RETURN_CREATE',
          body.date,
          money.cashRefund,
          actor,
        );
        if (old) {
          await tx.palletReturn.update({
            where: { id: old.id },
            data: { reversedAt, reversedByUserId: actor.userId, reversalKind: 'EDIT', replacedByReturnId: created.id },
          });
        }
        await recomputeOrder(tx, order.id, { bumpVersion: true });
        const { accepted, damaged } = countsOf(priced);
        returns.push({
          returnId: created.id,
          refundEntryId: refund?.id ?? null,
          accepted,
          damaged,
          orderId: order.id,
          orderNumber: order.orderNumber,
          refundDue: money.refundDue,
          owedBefore: money.owedBefore,
          cashRefund: money.cashRefund,
          owedAfter: money.owedAfter,
        });
        const snapshot = await this.snapshot(tx, created.id);
        if (grouped) {
          after.push({
            orderNumber: order.orderNumber,
            ...snapshot,
            replacesReturnId: old?.id ?? null,
            refund: refund ? toAuditSnapshot('LEDGER_ENTRY', refund) : null,
            refundReversal: reversal ? toAuditSnapshot('LEDGER_ENTRY', reversal) : null,
          });
        }
        if (old && !oldGrouped) {
          await this.audit.record(tx, {
            action: 'RETURN_EDIT',
            entityType: 'RETURN',
            entityId: String(old.id),
            summaryParams: { orderNumber: order.orderNumber, newReturnId: created.id },
            before: this.snapshotOf(old),
            after: snapshot,
          });
        }
        if (grouped) continue;
        if (!old) {
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
            after: snapshot,
          });
        }
        for (const entry of [reversal, refund]) {
          if (entry) await this.audit.record(tx, ledgerAuditEntry(entry, order.orderNumber));
        }
      }
      // The extra pallets taken back and written anew, in that one stock call (Q20).
      const written = await this.writeSurplus(tx, customer, body, kept, returns, actor, surplusRows);
      await this.stock.apply(tx, [...movements, ...written.movements], actor.userId);
      const surplus = written.surplus;

      // Judged on the database as the edit leaves it: extra pallets only of a type none of which is out any more, and
      // nothing owed beside pallets out (Q170's one rule).
      const touched = [
        ...new Set([
          ...oldItemIds,
          ...kept.flatMap(({ priced }) => priced.map((line) => line.itemId)),
          ...surplusRows.map((row) => row.itemId),
          ...body.surplus.map((extra) => extra.itemId),
        ]),
      ];
      const out = await openOutByItem(tx, customerId, touched);
      for (const extra of body.surplus) {
        const outQuantity = out.get(extra.itemId) ?? 0;
        if (outQuantity > 0) throw new ApiError('PALLET_SURPLUS_STILL_OUT', { itemId: extra.itemId, outQuantity });
      }
      await this.credits.assertNotOwedWhileOut(tx, customerId, touched);

      if (grouped) {
        await this.audit.record(tx, {
          action: 'RETURN_EDIT',
          entityType: 'CUSTOMER_RETURN',
          entityId: String(visit?.id ?? target.customerReturnId ?? target.id),
          summaryParams: { customerName: customer.name, ...visitFigures(returns) },
          // The customer in both, so the row links to them whatever the edit left (§11.4).
          before: { customerId, customerReturnId: target.customerReturnId, returns: before },
          after: {
            ...(visit ? toAuditSnapshot('CUSTOMER_RETURN', visit) : {}),
            customerId,
            replaces: oldIds,
            returns: after,
          },
        });
      }
      return { customerReturnId: visit?.id ?? null, customer: toCustomerRef(customer), returns, surplus };
    });
  }

  /**
   * Pallets beyond what was out (Q170), each on the new return of the latest order it came back on, written with
   * `reversed` (an edit's old extra taken back); their stock movements are given back for the caller's one stock call
   * (Q20). A history row says what is newly owed of each item — on one order as over several, where the visit's row
   * speaks only of the return —, an edit's only for what it adds beyond the extra it took back, so an extra merely
   * carried over to the new return says nothing new.
   */
  private async writeSurplus(
    tx: Prisma.TransactionClient,
    customer: { id: number; name: string },
    body: CustomerReturnCreateBody,
    carriers: readonly { order: { id: number }; priced: readonly PricedReturnLine[] }[],
    returns: readonly CustomerReturnRecordedDto[],
    actor: AuthContext,
    reversed: readonly SurplusRow[] = [],
  ): Promise<{ surplus: CustomerReturnResultDto['surplus']; movements: StockMovementInput[] }> {
    const surplus: CustomerReturnResultDto['surplus'] = [];
    const surplusItems = new Map(
      body.surplus.length === 0
        ? []
        : (
            await tx.item.findMany({
              where: { id: { in: body.surplus.map((extra) => extra.itemId) } },
              ...ITEM_REF_INCLUDE,
            })
          ).map((item) => [item.id, item]),
    );
    const entries = body.surplus.map((extra) => {
      const on = [...carriers].reverse().find(({ priced }) => priced.some((line) => line.itemId === extra.itemId));
      const pr = on && returns.find((entry) => entry.orderId === on.order.id);
      const item = surplusItems.get(extra.itemId);
      if (!pr || !item) throw new Error(`Surplus of item ${extra.itemId} has no return to stand on`);
      surplus.push({ item: toItemRef(item), quantity: extra.quantity });
      return {
        customerId: customer.id,
        itemId: extra.itemId,
        quantity: extra.quantity,
        reason: 'RETURN_SURPLUS' as const,
        returnId: pr.returnId,
        date: body.date,
      };
    });
    const { created, movements } = await this.credits.insertMany(
      tx,
      [
        ...reversed.map((row) => ({
          customerId: customer.id,
          itemId: row.itemId,
          quantity: -row.quantity,
          reason: 'RETURN_REVERSAL' as const,
          returnId: row.returnId,
          // Dated the day it is undone, as a deletion's (`reverseForReturn`) and the refund's reversal.
          date: businessToday(this.clock.now()),
        })),
        ...entries,
      ],
      actor,
    );
    const takenBack = (itemId: number) =>
      reversed.filter((row) => row.itemId === itemId).reduce((total, row) => total + row.quantity, 0);
    for (const credit of created.filter((entry) => entry.reason === 'RETURN_SURPLUS')) {
      const added = credit.quantity - takenBack(credit.itemId);
      if (added <= 0) continue;
      const item = surplusItems.get(credit.itemId);
      await this.audit.record(tx, {
        action: 'CREATE',
        entityType: 'PALLET_CREDIT',
        entityId: String(credit.id),
        // The count and the name apart, so each keeps its own direction in the sentence.
        summaryParams: { customerName: customer.name, itemName: item?.name ?? '', quantity: added },
        after: toAuditSnapshot('PALLET_CREDIT', credit),
      });
    }
    return { surplus, movements };
  }

  /** `validateReturnAgainstOrder` and the price of §4.3, against the locked order as it stands. */
  private check(order: ReturnOrder, body: ReturnCreateBody) {
    const state = toOrderState(order);
    const priced = validateReturnAgainstOrder(this.returnable(order, state), body);
    return { priced, money: priceReturn(priced, computeOrderTotals(state).owed) };
  }

  /**
   * Writes a checked return on its locked order (§4.8.4): the row, its stock, its refund, the totals, the audit. A
   * return of a customer's visit (`customerReturnId`) leaves its audit to the visit's one row (Q161), which takes the
   * snapshot returned here.
   */
  private async write(
    tx: Prisma.TransactionClient,
    order: ReturnOrder,
    body: ReturnCreateBody,
    priced: PricedReturnLine[],
    money: ReturnType<typeof priceReturn>,
    actor: AuthContext,
    customerReturnId: number | null = null,
  ): Promise<{
    returnId: number;
    refundEntryId: number | null;
    accepted: number;
    damaged: number;
    snapshot: Record<string, unknown>;
    refund: LedgerEntry | null;
  }> {
    const { accepted, damaged } = countsOf(priced);
    const created = await this.insertReturn(tx, order.id, body, priced, money, actor.userId, customerReturnId);
    await this.stock.apply(tx, this.accepted(priced, 'RETURN_ACCEPTED', order.id, created.id, 1), actor.userId);
    const refund = await this.refund(tx, order.id, created.id, 'RETURN_CREATE', body.date, money.cashRefund, actor);
    await recomputeOrder(tx, order.id, { bumpVersion: true });

    const snapshot = await this.snapshot(tx, created.id);
    const written = { returnId: created.id, refundEntryId: refund?.id ?? null, accepted, damaged, snapshot, refund };
    if (customerReturnId !== null) return written;
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
      after: snapshot,
    });
    if (refund) await this.audit.record(tx, ledgerAuditEntry(refund, order.orderNumber));
    return written;
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
      // Read once: the items it moves are locked with the return's own (§6.6), then it is carried over (Q170).
      const surplus = await this.credits.surplusOf(tx, this.surplusKey(old));
      await lockItems(tx, [
        ...old.lines.map((line) => line.orderLine.itemId),
        ...this.itemIdsOf(order, body.lines),
        ...surplus.map((row) => row.itemId),
      ]);

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
      // Its surplus moves to the replacement, refused if the correction puts pallets of that type out again; and no
      // correction may put out again a type the factory still owes this customer (Q170).
      await this.credits.carryOverForReplace(
        tx,
        { id: old.id, customerId: order.customerId },
        surplus,
        created.id,
        body.date,
        actor,
      );
      await this.credits.assertNotOwedWhileOut(tx, order.customerId, [
        ...old.lines.map((line) => line.orderLine.itemId),
        ...priced.map((line) => line.itemId),
      ]);

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
      const surplus = await this.credits.surplusOf(tx, this.surplusKey(old));
      await lockItems(tx, [...old.lines.map((line) => line.orderLine.itemId), ...surplus.map((row) => row.itemId)]);
      // Its surplus goes with it (Q170), refused if the factory has given those pallets back since.
      await this.credits.reverseForReturn(
        tx,
        { id: old.id, customerId: order.customerId },
        surplus,
        businessToday(this.clock.now()),
        actor,
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
      // Its pallets are out again: refused while the factory still owes this customer pallets of that type (Q170).
      await this.credits.assertNotOwedWhileOut(
        tx,
        order.customerId,
        old.lines.map((line) => line.orderLine.itemId),
      );

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

  /** What `PalletCreditsService` needs to find the surplus a return takes back with it (Q170). */
  private surplusKey(pr: StoredReturn): { id: number; customerReturnId: number | null; itemIds: number[] } {
    return {
      id: pr.id,
      customerReturnId: pr.customerReturnId,
      itemIds: pr.lines.map((line) => line.orderLine.itemId),
    };
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
    customerReturnId: number | null = null,
  ) {
    return tx.palletReturn.create({
      data: {
        orderId,
        customerReturnId,
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

  /**
   * The REFUND a return pays out when it credits more than was owed (§4.7.2); none when there is nothing to pay. The
   * database writes its customer return, its return's (Q161).
   */
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
