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
import { runInTransaction } from '../../prisma/transaction';
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
import { PalletCreditsService } from './pallet-credits.service';
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
          const on = [...checked].reverse().find(({ priced }) => priced.some((line) => line.itemId === extra.itemId));
          const pr = on && returns.find((entry) => entry.orderId === on.order.id);
          const item = surplusItems.get(extra.itemId);
          if (!pr || !item) throw new Error(`Surplus of item ${extra.itemId} has no return to stand on`);
          surplus.push({ item: toItemRef(item), quantity: extra.quantity });
          return {
            customerId,
            itemId: extra.itemId,
            quantity: extra.quantity,
            reason: 'RETURN_SURPLUS' as const,
            returnId: pr.returnId,
            date: body.date,
          };
        });
        // One stock call for all of them (Q20).
        const credits = await this.credits.writeMany(tx, entries, actor);
        // Each credit it made gets a history row of its own, under its id, saying what is owed — on one order as over
        // several, where the visit's own row speaks only of the return.
        for (const credit of credits) {
          const item = surplusItems.get(credit.itemId);
          await this.audit.record(tx, {
            action: 'CREATE',
            entityType: 'PALLET_CREDIT',
            entityId: String(credit.id),
            // The count and the name apart, so each keeps its own direction in the sentence.
            summaryParams: { customerName: customer.name, itemName: item?.name ?? '', quantity: credit.quantity },
            after: toAuditSnapshot('PALLET_CREDIT', credit),
          });
        }
        if (visit) {
          const total = (pick: (entry: CustomerReturnRecordedDto) => number) =>
            returns.reduce((sum, entry) => sum + pick(entry), 0);
          await this.audit.record(tx, {
            action: 'RETURN_CREATE',
            entityType: 'CUSTOMER_RETURN',
            entityId: String(visit.id),
            summaryParams: {
              customerName: customer.name,
              orders: returns.length,
              accepted: total((entry) => entry.accepted),
              damaged: total((entry) => entry.damaged),
              refundDue: total((entry) => entry.refundDue),
              cashRefund: total((entry) => entry.cashRefund),
            },
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
      const outQuantity = (outOf.get(extra.itemId) ?? 0) - returned;
      if (returned === 0 || outQuantity > 0) {
        throw new ApiError('PALLET_SURPLUS_STILL_OUT', { itemId: extra.itemId, outQuantity });
      }
    }
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
    const accepted = priced.reduce((total, line) => total + line.acceptedQuantity, 0);
    const damaged = priced.reduce((total, line) => total + line.damagedQuantity, 0);
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
