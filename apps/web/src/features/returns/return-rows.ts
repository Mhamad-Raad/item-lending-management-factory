import { formatMoney } from '@pallet/shared';
import { useTranslation } from 'react-i18next';
import { isolate } from '@/lib/bidi';
import { encodeValidationMessage } from '@/lib/validation-message';

/** A return row's boxes as the form holds them; a cleared box is null. */
export interface RowCounts {
  accepted: number | null;
  damaged: number | null;
  damagedRefund: number | null;
}

/** The form key of an order line's row (`l<orderLineId>`): line ids are unique, across orders too. */
export const rowKey = (orderLineId: number): `l${number}` => `l${orderLineId}`;

/** A cleared box counts as 0. */
export const count = (value: number | null | undefined): number => value ?? 0;

/** A row's boxes as numbers, a missing or cleared box counting as 0. */
export function typedRow(counts: Partial<RowCounts> | undefined): TypedRow {
  return {
    accepted: count(counts?.accepted),
    damaged: count(counts?.damaged),
    damagedRefund: count(counts?.damagedRefund),
  };
}

/**
 * A row's "all back" (Q156): the rest of what is out accepted, a damaged count and refund already typed kept as typed —
 * wiping them would put broken pallets back into stock. Both return forms' quick buttons use it.
 */
export function restAccepted(counts: Partial<RowCounts> | undefined, outQuantity: number): TypedRow {
  const { damaged, damagedRefund } = typedRow(counts);
  return { accepted: Math.max(0, outQuantity - damaged), damaged, damagedRefund };
}

/** What a row prices in the summary: a refused row prices nothing, so no figure the server would refuse is offered. */
export function pricedRow(row: TypedRow, unitDeposit: number, invalid: boolean) {
  return {
    acceptedQuantity: invalid ? 0 : row.accepted,
    damagedQuantity: invalid ? 0 : row.damaged,
    damagedRefund: invalid ? 0 : row.damagedRefund,
    unitDeposit,
  };
}

/** A row of a return as typed, a cleared box counting as 0. */
export interface TypedRow {
  accepted: number;
  damaged: number;
  damagedRefund: number;
}

/**
 * The rules of one return row (Q141, Q146), shared by the order's form and the customer's: what it returns, whether
 * that is more than is out, the most its damage refund can give back, and whether the refund is over it. `refused`
 * holds what the server last said about the row, which stands until the row changes.
 */
export function checkRow(
  row: TypedRow,
  line: { outQuantity: number; unitDeposit: number },
  refused?: { accepted?: unknown; damagedRefund?: unknown },
) {
  const returning = row.accepted + row.damaged;
  const overOut = returning > line.outQuantity || Boolean(refused?.accepted);
  const maximum = row.damaged * line.unitDeposit;
  const refundOver = row.damagedRefund > maximum || Boolean(refused?.damagedRefund);
  return { returning, overOut, maximum, refundOver, invalid: overOut || refundOver };
}

/** The row messages both forms show, and an amount with its currency kept whole inside a right-to-left sentence. */
export function useRowMessages() {
  const { t } = useTranslation();
  return {
    exceedsOut: (limit: number): string => encodeValidationMessage('returnExceedsOut', { out: limit }),
    refundTooHigh: (maximum: number): string =>
      encodeValidationMessage('damagedRefundTooHigh', { maximum: formatMoney(maximum) }),
    money: (amount: number): string => isolate(`${formatMoney(amount)} ${t('common.currency')}`),
  };
}
