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

/** A credit refusal the server reported on a new order, with the customer it was reported for. */
export interface ServerCreditRefusal extends CreditExcess {
  customerId: number;
}

/**
 * The server's refusal while it still describes the form: the same customer and the same total. Once
 * either changes — another customer picked, a line edited — the live check decides again; a refusal
 * for one customer must never block, or show its figures on, another's order.
 */
export function standingCreditRefusal(
  refusal: ServerCreditRefusal | null,
  customerId: number | null,
  depositTotal: number,
): ServerCreditRefusal | null {
  return refusal && refusal.customerId === customerId && refusal.depositDelta === depositTotal ? refusal : null;
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
