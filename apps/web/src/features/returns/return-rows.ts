import { formatMoney } from '@pallet/shared';
import { useTranslation } from 'react-i18next';
import { isolate } from '@/lib/bidi';
import { encodeValidationMessage } from '@/lib/validation-message';

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
