import { formatMoney, formatOrderNumber } from '@pallet/shared';

/** How the UI names an order: its number six digits wide (A6). */
export function orderLabel(orderNumber: number): string {
  return `#${formatOrderNumber(orderNumber)}`;
}

/** What the credit rule found (§4.4), from the live check or from the server's refusal. */
export interface CreditExcess {
  creditLimit: number;
  customerOutValue: number;
  depositDelta: number;
  excess: number;
}

/** The four figures the credit alert and the override dialog show, formatted. */
export function creditMessageParams(credit: CreditExcess): {
  limit: string;
  outValue: string;
  newTotal: string;
  excess: string;
} {
  return {
    limit: formatMoney(credit.creditLimit),
    outValue: formatMoney(credit.customerOutValue),
    newTotal: formatMoney(credit.depositDelta),
    excess: formatMoney(credit.excess),
  };
}
