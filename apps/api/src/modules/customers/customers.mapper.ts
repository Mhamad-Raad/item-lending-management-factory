import type { CustomerDto, CustomerRefDto } from '@pallet/shared';
import { toSafeMoney } from '../../common/utils/money';
import type { Customer } from '../../generated/prisma/client';

/** A customer's §4.5 sums over its orders that are not cancelled. */
export interface OrderTotals {
  palletsOut: number;
  outValue: number;
  owed: number;
  held: number;
  compensation: number;
  openOrderCount: number;
}

/** What a customer without orders has. */
export const NO_ORDERS: OrderTotals = {
  palletsOut: 0,
  outValue: 0,
  owed: 0,
  held: 0,
  compensation: 0,
  openOrderCount: 0,
};

export function toCustomerDto(row: Customer, totals: OrderTotals): CustomerDto {
  const creditLimit = row.creditLimit === null ? null : toSafeMoney(row.creditLimit);
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    altPhone: row.altPhone,
    address: row.address,
    creditLimit,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // Headroom may go negative after an admin override; it is shown as it is (§4.5).
    summary: { ...totals, creditLimit, headroom: creditLimit === null ? null : creditLimit - totals.outValue },
  };
}

/** How another record names a customer, archived or not. */
export function toCustomerRef(customer: Customer): CustomerRefDto {
  return { id: customer.id, name: customer.name, phone: customer.phone, archived: customer.archivedAt !== null };
}
