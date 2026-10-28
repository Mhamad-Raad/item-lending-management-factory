import {
  dbDateToBusiness,
  type OrderDetailDto,
  type OrderLineDto,
  type OrderListItemDto,
  type ReturnDto,
  type ReturnWithOrderDto,
} from '@pallet/shared';
import { toSafeMoney } from '../../common/utils/money';
import type { Prisma } from '../../generated/prisma/client';
import { toCustomerRef } from '../customers/customers.mapper';
import { toDriverRef } from '../drivers/drivers.mapper';
import { ITEM_REF_INCLUDE, toItemRef } from '../items/items.mapper';
import { LEDGER_ENTRY_INCLUDE, toLedgerEntryDto } from '../ledger/ledger.mapper';
import { USER_REF_SELECT, toUserRef } from '../users/users.mapper';

const USER_REF = USER_REF_SELECT;

export const ORDER_LIST_INCLUDE = { customer: true, driver: true } as const satisfies Prisma.OrderInclude;

/** Everything the order page shows, in the orders the DTO lists them (§6.19). */
export const ORDER_DETAIL_INCLUDE = {
  customer: true,
  driver: true,
  createdBy: USER_REF,
  cancelledBy: USER_REF,
  creditOverrideBy: USER_REF,
  lines: { orderBy: { id: 'asc' }, include: { item: ITEM_REF_INCLUDE } },
  returns: {
    orderBy: { id: 'asc' },
    include: {
      lines: { orderBy: { id: 'asc' }, include: { orderLine: { include: { item: ITEM_REF_INCLUDE } } } },
      reversedBy: USER_REF,
      createdBy: USER_REF,
      replaces: { select: { id: true } },
      withOrder: { select: { id: true, orderNumber: true } },
    },
  },
  ledgerEntries: { orderBy: { id: 'asc' }, include: LEDGER_ENTRY_INCLUDE },
  palletCredits: { orderBy: { id: 'asc' }, include: { item: ITEM_REF_INCLUDE } },
  // Other orders' standing returns recorded from its page (Q175): activity, as its own.
  returnsWith: { where: { reversedAt: null }, select: { orderId: true } },
} as const satisfies Prisma.OrderInclude;

type OrderLineRow = Prisma.OrderLineGetPayload<{ include: { item: typeof ITEM_REF_INCLUDE } }>;

/** A line with the totals `recomputeOrder()` keeps on it (§6.19). */
export function toOrderLineDto(line: OrderLineRow): OrderLineDto {
  return {
    id: line.id,
    item: toItemRef(line.item),
    quantity: line.quantity,
    unitDeposit: toSafeMoney(line.unitDeposit),
    lineTotal: toSafeMoney(line.lineTotal),
    returnedAccepted: line.returnedAccepted,
    returnedDamaged: line.returnedDamaged,
    outQuantity: line.outQuantity,
  };
}

type OrderListRow = Prisma.OrderGetPayload<{ include: typeof ORDER_LIST_INCLUDE }>;
type OrderDetailRow = Prisma.OrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;

export function toOrderListItemDto(order: OrderListRow): OrderListItemDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    date: dbDateToBusiness(order.date),
    paymentType: order.paymentType,
    status: order.status,
    customer: toCustomerRef(order.customer),
    driver: toDriverRef(order.driver),
    depositTotal: toSafeMoney(order.depositTotal),
    owed: toSafeMoney(order.owed),
    outValue: toSafeMoney(order.outValue),
    held: toSafeMoney(order.held),
    outQuantityTotal: order.outQuantityTotal,
    createdAt: order.createdAt.toISOString(),
  };
}

/** The order a return was recorded with, said only when it is another than its own (Q175). */
export function otherWithOrder(pr: {
  orderId: number;
  withOrder: ReturnWithOrderDto | null;
}): ReturnWithOrderDto | null {
  return pr.withOrder && pr.withOrder.id !== pr.orderId
    ? { id: pr.withOrder.id, orderNumber: pr.withOrder.orderNumber }
    : null;
}

function toReturnDto(order: OrderDetailRow, pr: OrderDetailRow['returns'][number]): ReturnDto {
  return {
    id: pr.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    date: dbDateToBusiness(pr.date),
    notes: pr.notes,
    refundDue: toSafeMoney(pr.refundDue),
    owedBefore: toSafeMoney(pr.owedBefore),
    cashRefund: toSafeMoney(pr.cashRefund),
    lines: pr.lines.map((line) => {
      const unitDeposit = toSafeMoney(line.unitDeposit);
      const damagedRefund = toSafeMoney(line.damagedRefund);
      return {
        id: line.id,
        orderLineId: line.orderLineId,
        item: toItemRef(line.orderLine.item),
        acceptedQuantity: line.acceptedQuantity,
        damagedQuantity: line.damagedQuantity,
        unitDeposit,
        damagedRefund,
        compensation: line.damagedQuantity * unitDeposit - damagedRefund,
      };
    }),
    reversed: pr.reversedAt !== null,
    reversedAt: pr.reversedAt?.toISOString() ?? null,
    reversedBy: pr.reversedBy ? toUserRef(pr.reversedBy) : null,
    reversalKind: pr.reversalKind,
    replacedByReturnId: pr.replacedByReturnId,
    replacesReturnId: pr.replaces?.id ?? null,
    canReverse: pr.reversedAt === null,
    createdAt: pr.createdAt.toISOString(),
    createdBy: toUserRef(pr.createdBy),
    customerReturnId: pr.customerReturnId,
    withOrder: otherWithOrder(pr),
  };
}

export function toOrderDetailDto(order: OrderDetailRow): OrderDetailDto {
  // Lines stay editable, and the order cancellable, until something has happened on it (§4.8.2).
  const hasActivity =
    order.returns.some((pr) => pr.reversedAt === null) ||
    order.returnsWith.some((pr) => pr.orderId !== order.id) ||
    order.ledgerEntries.some(
      (entry) => entry.type === 'PAYMENT' && entry.source === 'MANUAL' && entry.reversedBy === null,
    );
  const open = order.cancelledAt === null && !hasActivity;

  return {
    ...toOrderListItemDto(order),
    notes: order.notes,
    paymentsNet: toSafeMoney(order.paymentsNet),
    creditsTotal: toSafeMoney(order.creditsTotal),
    refundsNet: toSafeMoney(order.refundsNet),
    compensation: toSafeMoney(order.compensation),
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    cancelledBy: order.cancelledBy ? toUserRef(order.cancelledBy) : null,
    creditOverride:
      order.creditOverrideBy && order.creditOverrideAt
        ? { by: toUserRef(order.creditOverrideBy), at: order.creditOverrideAt.toISOString() }
        : null,
    lines: order.lines.map(toOrderLineDto),
    returns: order.returns.map((pr) => toReturnDto(order, pr)),
    ledgerEntries: order.ledgerEntries.map((entry) => toLedgerEntryDto(entry, order)),
    fromCredit: fromCreditOf(order.palletCredits),
    canEditLines: open,
    canCancel: open,
    version: order.version,
    updatedAt: order.updatedAt.toISOString(),
    createdBy: toUserRef(order.createdBy),
  };
}

/**
 * What an order took of the pallets the factory owed, by item, net of what a cancel or an edit gave back (Q170): the one
 * reading the order page and its hand-over receipt share. Each with the item's first entry, for its name.
 */
export function netFromCredit<T extends { itemId: number; quantity: number }>(
  rows: readonly T[],
): { first: T; quantity: number }[] {
  const byItem = new Map<number, { first: T; quantity: number }>();
  for (const row of rows) {
    const entry = byItem.get(row.itemId) ?? { first: row, quantity: 0 };
    entry.quantity -= row.quantity;
    byItem.set(row.itemId, entry);
  }
  return [...byItem.values()].filter((entry) => entry.quantity > 0);
}

function fromCreditOf(
  rows: Prisma.PalletCreditGetPayload<{ include: { item: typeof ITEM_REF_INCLUDE } }>[],
): OrderDetailDto['fromCredit'] {
  return netFromCredit(rows).map(({ first, quantity }) => ({ item: toItemRef(first.item), quantity }));
}
