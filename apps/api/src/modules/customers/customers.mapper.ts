import type { CustomerDto, CustomerHoldingDto, CustomerRefDto } from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
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

/**
 * What a customer's orders are worth — out value, owed, held, compensation, headroom — is order data:
 * it is returned only to a caller who may read orders, and otherwise left out, as cost is (Q72).
 */
export function mayViewOrderMoney(actor: AuthContext): boolean {
  return actor.permissions.has('orders.view');
}

export function toCustomerDto(row: Customer, totals: OrderTotals, withMoney: boolean): CustomerDto {
  const creditLimit = row.creditLimit === null ? null : toSafeMoney(row.creditLimit);
  const { palletsOut, openOrderCount } = totals;
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
    summary: withMoney
      ? // Headroom may go negative after an admin override; it is shown as it is (§4.5).
        { ...totals, creditLimit, headroom: creditLimit === null ? null : creditLimit - totals.outValue }
      : { palletsOut, creditLimit, openOrderCount },
  };
}

/** A holding without its money: quantities and source orders stay, deposits go (Q72). */
export function withoutHoldingMoney({
  outValue: _outValue,
  sources,
  ...holding
}: CustomerHoldingDto): CustomerHoldingDto {
  return { ...holding, sources: sources.map(({ unitDeposit: _unitDeposit, ...source }) => source) };
}

/** How another record names a customer, archived or not. */
export function toCustomerRef(customer: Customer): CustomerRefDto {
  return { id: customer.id, name: customer.name, phone: customer.phone, archived: customer.archivedAt !== null };
}
