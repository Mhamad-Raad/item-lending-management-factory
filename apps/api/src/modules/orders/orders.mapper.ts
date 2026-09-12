import {
  dbDateToBusiness,
  type CustomerRefDto,
  type DriverRefDto,
  type LedgerEntryDto,
  type OrderDetailDto,
  type OrderListItemDto,
  type ReturnDto,
  type UserRefDto,
} from '@pallet/shared';
import { toSafeMoney } from '../../common/utils/money';
import type { Customer, Driver, Prisma, User } from '../../generated/prisma/client';
import { toItemRef } from '../items/items.mapper';

const USER_REF = { select: { id: true, username: true, displayName: true } } as const;
const ITEM_REF = { include: { image: { select: { fileName: true } } } } as const;

export const ORDER_LIST_INCLUDE = { customer: true, driver: true } as const satisfies Prisma.OrderInclude;

/** Everything the order page shows, in the orders the DTO lists them (§6.19). */
export const ORDER_DETAIL_INCLUDE = {
  customer: true,
  driver: true,
  createdBy: USER_REF,
  cancelledBy: USER_REF,
  creditOverrideBy: USER_REF,
  lines: { orderBy: { id: 'asc' }, include: { item: ITEM_REF } },
  returns: {
    orderBy: { id: 'asc' },
    include: {
      lines: { orderBy: { id: 'asc' }, include: { orderLine: { include: { item: ITEM_REF } } } },
      reversedBy: USER_REF,
      createdBy: USER_REF,
      replaces: { select: { id: true } },
    },
  },
  ledgerEntries: { orderBy: { id: 'asc' }, include: { createdBy: USER_REF, reversedBy: { select: { id: true } } } },
} as const satisfies Prisma.OrderInclude;

type OrderListRow = Prisma.OrderGetPayload<{ include: typeof ORDER_LIST_INCLUDE }>;
type OrderDetailRow = Prisma.OrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;

export function toCustomerRef(customer: Customer): CustomerRefDto {
  return { id: customer.id, name: customer.name, phone: customer.phone, archived: customer.archivedAt !== null };
}

export function toDriverRef(driver: Driver): DriverRefDto {
  return {
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    carNumber: driver.carNumber,
    archived: driver.archivedAt !== null,
  };
}

function toUserRef(user: Pick<User, 'id' | 'username' | 'displayName'>): UserRefDto {
  return { id: user.id, username: user.username, displayName: user.displayName };
}

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
  };
}

function toLedgerEntryDto(order: OrderDetailRow, entry: OrderDetailRow['ledgerEntries'][number]): LedgerEntryDto {
  const isReversed = entry.reversedBy !== null;
  return {
    id: entry.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    customer: toCustomerRef(order.customer),
    type: entry.type,
    source: entry.source,
    amount: toSafeMoney(entry.amount),
    date: entry.date ? dbDateToBusiness(entry.date) : null,
    // The automatic hand-over payment has no date of its own: it happened on the order's (§4.7.2).
    effectiveDate: dbDateToBusiness(entry.date ?? order.date),
    isAutomatic: entry.isAutomatic,
    returnId: entry.returnId,
    reversesEntryId: entry.reversesEntryId,
    reversedByEntryId: entry.reversedBy?.id ?? null,
    isReversed,
    canReverse: entry.type === 'PAYMENT' && entry.source === 'MANUAL' && !isReversed,
    note: entry.note,
    createdAt: entry.createdAt.toISOString(),
    createdBy: toUserRef(entry.createdBy),
  };
}

export function toOrderDetailDto(order: OrderDetailRow): OrderDetailDto {
  // Lines stay editable, and the order cancellable, until something has happened on it (§4.8.2).
  const hasActivity =
    order.returns.some((pr) => pr.reversedAt === null) ||
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
    lines: order.lines.map((line) => ({
      id: line.id,
      item: toItemRef(line.item),
      quantity: line.quantity,
      unitDeposit: toSafeMoney(line.unitDeposit),
      lineTotal: toSafeMoney(line.lineTotal),
      returnedAccepted: line.returnedAccepted,
      returnedDamaged: line.returnedDamaged,
      outQuantity: line.outQuantity,
    })),
    returns: order.returns.map((pr) => toReturnDto(order, pr)),
    ledgerEntries: order.ledgerEntries.map((entry) => toLedgerEntryDto(order, entry)),
    canEditLines: open,
    canCancel: open,
    version: order.version,
    updatedAt: order.updatedAt.toISOString(),
    createdBy: toUserRef(order.createdBy),
  };
}
