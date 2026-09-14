import { dbDateToBusiness } from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { ApiError } from '../../common/errors/api-error';
import { safeProduct } from '../../common/utils/money';
import type { Item, Prisma } from '../../generated/prisma/client';

/**
 * The checks an order request needs before any row (§6.19): supplying a unit deposit needs
 * `orders.editUnitDeposit` (Q15), and only an admin may confirm a credit override.
 */
export function assertMayPriceAndOverride(
  lines: readonly { unitDeposit?: number }[],
  confirmCreditOverride: boolean,
  actor: AuthContext,
): void {
  const pricedLines = lines.flatMap((line, index) => (line.unitDeposit === undefined ? [] : [index]));
  if (pricedLines.length > 0 && !actor.permissions.has('orders.editUnitDeposit')) {
    throw new ApiError('UNIT_DEPOSIT_NOT_PERMITTED', { lineIndexes: pricedLines });
  }
  if (confirmCreditOverride && !actor.isAdmin) throw new ApiError('ADMIN_ONLY');
}

/** An order as the edit and cancel checks read it. */
export const ORDER_CHANGE_INCLUDE = {
  customer: true,
  lines: { orderBy: { id: 'asc' }, include: { item: true } },
  returns: { select: { date: true, reversedAt: true } },
  ledgerEntries: { orderBy: { id: 'asc' }, include: { reversedBy: { select: { id: true } } } },
} as const satisfies Prisma.OrderInclude;

export type ChangeableOrder = Prisma.OrderGetPayload<{ include: typeof ORDER_CHANGE_INCLUDE }>;

/** What has happened on an order since it was handed over (§4.8.2). */
export interface OrderActivity {
  nonReversedReturnCount: number;
  nonReversedManualPaymentCount: number;
  /** The earliest date among them, which bounds the order's own date. */
  earliestDate: string | null;
}

/**
 * The returns and manual payments of an order that are not reversed. Once there is any, its lines are
 * frozen and it cannot be cancelled; `ORDER_HAS_ACTIVITY` reports the counts.
 */
export function orderActivity(order: ChangeableOrder): OrderActivity {
  const returns = order.returns.filter((pr) => pr.reversedAt === null);
  const payments = order.ledgerEntries.filter(
    (entry) => entry.type === 'PAYMENT' && entry.source === 'MANUAL' && entry.reversedBy === null,
  );
  const dates = [...returns.map((pr) => pr.date), ...payments.flatMap((entry) => (entry.date ? [entry.date] : []))]
    .map(dbDateToBusiness)
    .sort();
  return {
    nonReversedReturnCount: returns.length,
    nonReversedManualPaymentCount: payments.length,
    earliestDate: dates[0] ?? null,
  };
}

/** Refuses a line edit or a cancel on an order with activity (§4.8.2, §4.8.3). */
export function assertNoActivity(activity: OrderActivity): void {
  const { nonReversedReturnCount, nonReversedManualPaymentCount } = activity;
  if (nonReversedReturnCount + nonReversedManualPaymentCount > 0) {
    throw new ApiError('ORDER_HAS_ACTIVITY', { nonReversedReturnCount, nonReversedManualPaymentCount });
  }
}

/** The automatic payment that stands for a cash order's deposit, if it has not been reversed. */
export function standingAutomaticPayment(order: ChangeableOrder): ChangeableOrder['ledgerEntries'][number] | null {
  return (
    order.ledgerEntries.find((entry) => entry.type === 'PAYMENT' && entry.isAutomatic && entry.reversedBy === null) ??
    null
  );
}

/** An order line as it is stored: its quantity at a unit deposit, and their product. */
export interface PricedLine {
  itemId: number;
  quantity: number;
  unitDeposit: number;
  lineTotal: number;
}

/** An item a line may hand out more of: it exists and is not archived (§6.19 step 8). */
export function assertItemOrderable(item: Pick<Item, 'archivedAt'> | undefined, itemId: number): asserts item {
  if (!item) throw new ApiError('ITEM_NOT_FOUND', { itemId });
  if (item.archivedAt) throw new ApiError('ITEM_ARCHIVED', { itemId });
}

/** Prices a requested line at its own unit deposit, or `defaultDeposit`; the product must stay a safe integer. */
export function priceLine(
  line: { itemId: number; quantity: number; unitDeposit?: number },
  defaultDeposit: number,
  index: number,
): PricedLine {
  const unitDeposit = line.unitDeposit ?? defaultDeposit;
  return {
    itemId: line.itemId,
    quantity: line.quantity,
    unitDeposit,
    lineTotal: safeProduct(line.quantity, unitDeposit, `lines.${index}.unitDeposit`),
  };
}

/** The order's deposit total, refused when the sum is past what money can hold. */
export function depositTotalOf(lines: readonly PricedLine[]): number {
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  if (!Number.isSafeInteger(total)) {
    throw new ApiError('VALIDATION_FAILED', undefined, [
      { path: 'lines', code: 'too_big', params: { maximum: Number.MAX_SAFE_INTEGER } },
    ]);
  }
  return total;
}
