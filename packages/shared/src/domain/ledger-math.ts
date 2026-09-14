/**
 * Pure implementation of ARCHITECTURE.md section 4 (business rules).
 * Used by the API (recomputeOrder, return/payment/credit checks) and by the web app
 * (live totals while the user types). All money is whole IQD as safe integers.
 */
import type { LedgerEntryType, OrderStatus } from '../enums.js';

export const RECEIPT_LINES_PER_HALF = 6;
export const MONEY_INPUT_MAX = 1_000_000_000_000;
export const QUANTITY_INPUT_MAX = 1_000_000;

export interface OrderLineState {
  id: number;
  quantity: number;
  unitDeposit: number;
}

export interface ReturnLineState {
  orderLineId: number;
  acceptedQuantity: number;
  damagedQuantity: number;
  damagedRefund: number;
}

export interface ReturnState {
  reversed: boolean;
  lines: readonly ReturnLineState[];
}

export interface LedgerEntryState {
  type: LedgerEntryType;
  amount: number;
}

export interface OrderState {
  cancelled: boolean;
  lines: readonly OrderLineState[];
  /** All returns of the order, reversed ones included (they are ignored). */
  returns: readonly ReturnState[];
  /** All ledger rows of the order, reversal rows included. */
  ledger: readonly LedgerEntryState[];
}

export interface LineTotals {
  id: number;
  lineTotal: number;
  returnedAccepted: number;
  returnedDamaged: number;
  outQuantity: number;
}

export interface OrderTotals {
  lines: LineTotals[];
  depositTotal: number;
  paymentsNet: number;
  creditsTotal: number;
  refundsNet: number;
  owed: number;
  outQuantityTotal: number;
  outValue: number;
  held: number;
  compensation: number;
  status: OrderStatus;
}

export class LedgerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerInvariantError';
  }
}

function assertSafe(n: number, label: string): number {
  if (!Number.isSafeInteger(n)) throw new LedgerInvariantError(`${label} is not a safe integer: ${n}`);
  return n;
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** A return line's unit deposit, from the order line it belongs to; a line the order does not have is corrupt data. */
function depositOf(unitDepositByLine: ReadonlyMap<number, number>, orderLineId: number): number {
  const unitDeposit = unitDepositByLine.get(orderLineId);
  if (unitDeposit === undefined) throw new LedgerInvariantError(`return line of an unknown order line ${orderLineId}`);
  return unitDeposit;
}

/** refundDue = Σ (acceptedQuantity × unitDeposit + damagedRefund) over the return's entries. */
export function returnRefundDue(
  lines: readonly { acceptedQuantity: number; unitDeposit: number; damagedRefund: number }[],
): number {
  return assertSafe(sum(lines.map((l) => l.acceptedQuantity * l.unitDeposit + l.damagedRefund)), 'refundDue');
}

/** cashRefund = max(0, refundDue − owedBefore); owedAfter = max(0, owedBefore − refundDue). */
export function returnMoney(owedBefore: number, refundDue: number): { cashRefund: number; owedAfter: number } {
  return {
    cashRefund: Math.max(0, refundDue - owedBefore),
    owedAfter: Math.max(0, owedBefore - refundDue),
  };
}

/** Section 4.1 + 4.2: every derived value of one order. Cancelled orders are all zero. */
export function computeOrderTotals(order: OrderState): OrderTotals {
  const lineTotalsRaw = order.lines.map((line) => ({
    id: line.id,
    lineTotal: assertSafe(line.quantity * line.unitDeposit, 'lineTotal'),
  }));
  const depositTotal = sum(lineTotalsRaw.map((l) => l.lineTotal));

  if (order.cancelled) {
    return {
      lines: lineTotalsRaw.map((l) => ({ ...l, returnedAccepted: 0, returnedDamaged: 0, outQuantity: 0 })),
      depositTotal,
      paymentsNet: 0,
      creditsTotal: 0,
      refundsNet: 0,
      owed: 0,
      outQuantityTotal: 0,
      outValue: 0,
      held: 0,
      compensation: 0,
      status: 'CANCELLED',
    };
  }

  const unitDepositByLine = new Map(order.lines.map((l) => [l.id, l.unitDeposit]));
  const activeReturns = order.returns.filter((r) => !r.reversed);
  const activeReturnLines = activeReturns.flatMap((r) => r.lines);

  const lines: LineTotals[] = order.lines.map((line, index) => {
    const entries = activeReturnLines.filter((rl) => rl.orderLineId === line.id);
    const returnedAccepted = sum(entries.map((e) => e.acceptedQuantity));
    const returnedDamaged = sum(entries.map((e) => e.damagedQuantity));
    const outQuantity = line.quantity - returnedAccepted - returnedDamaged;
    if (outQuantity < 0) throw new LedgerInvariantError(`outQuantity < 0 on line ${line.id}`);
    return {
      id: line.id,
      lineTotal: lineTotalsRaw[index]!.lineTotal,
      returnedAccepted,
      returnedDamaged,
      outQuantity,
    };
  });

  const net = (plus: LedgerEntryType, minus: LedgerEntryType) =>
    sum(order.ledger.filter((e) => e.type === plus).map((e) => e.amount)) -
    sum(order.ledger.filter((e) => e.type === minus).map((e) => e.amount));

  const paymentsNet = net('PAYMENT', 'PAYMENT_REVERSAL');
  const refundsNet = net('REFUND', 'REFUND_REVERSAL');
  const creditsTotal = sum(
    activeReturns.map((r) =>
      returnRefundDue(
        r.lines.map((rl) => ({
          acceptedQuantity: rl.acceptedQuantity,
          damagedRefund: rl.damagedRefund,
          unitDeposit: depositOf(unitDepositByLine, rl.orderLineId),
        })),
      ),
    ),
  );
  const owed = assertSafe(depositTotal - paymentsNet - creditsTotal + refundsNet, 'owed');
  if (owed < 0) throw new LedgerInvariantError(`owed < 0 (${owed})`);

  const outQuantityTotal = sum(lines.map((l) => l.outQuantity));
  const outValue = assertSafe(sum(order.lines.map((l, i) => lines[i]!.outQuantity * l.unitDeposit)), 'outValue');
  const held = Math.max(0, outValue - owed);
  const compensation = assertSafe(
    sum(
      activeReturnLines.map(
        (rl) => rl.damagedQuantity * depositOf(unitDepositByLine, rl.orderLineId) - rl.damagedRefund,
      ),
    ),
    'compensation',
  );
  const status: OrderStatus = outQuantityTotal > 0 || owed > 0 ? 'OPEN' : 'SETTLED';

  return {
    lines,
    depositTotal,
    paymentsNet,
    creditsTotal,
    refundsNet,
    owed,
    outQuantityTotal,
    outValue,
    held,
    compensation,
    status,
  };
}

export interface CreditCheckInput {
  /** null = no limit. */
  creditLimit: number | null;
  /** Σ outValue over the customer's non-cancelled orders (before this change). */
  customerOutValue: number;
  /** New order: its depositTotal. Line edit: newDepositTotal − oldDepositTotal. */
  depositDelta: number;
}

export interface CreditCheckResult {
  allowed: boolean;
  /** How much the limit would be exceeded by (0 when allowed). */
  excess: number;
}

/**
 * The order as it would stand had one of its returns been reversed (§4.8.5): what a replacement is checked and priced
 * against. The return at `returnIndex` is set aside, and `standingRefund` — the refund it paid out and that still
 * stands, 0 for none — is reversed with it.
 */
export function orderStateWithoutReturn(state: OrderState, returnIndex: number, standingRefund: number): OrderState {
  return {
    ...state,
    returns: state.returns.map((pr, at) => (at === returnIndex ? { ...pr, reversed: true } : pr)),
    ledger: standingRefund > 0 ? [...state.ledger, { type: 'REFUND_REVERSAL', amount: standingRefund }] : state.ledger,
  };
}

/** Section 4.4. */
export function checkCreditLimit({ creditLimit, customerOutValue, depositDelta }: CreditCheckInput): CreditCheckResult {
  if (creditLimit === null || depositDelta <= 0) return { allowed: true, excess: 0 };
  const excess = customerOutValue + depositDelta - creditLimit;
  return excess <= 0 ? { allowed: true, excess: 0 } : { allowed: false, excess };
}

/** Receipt overflow rule (A15): chunks of RECEIPT_LINES_PER_HALF; an empty order still yields one sheet. */
export function chunkReceiptLines<T>(lines: readonly T[], perHalf = RECEIPT_LINES_PER_HALF): T[][] {
  if (lines.length === 0) return [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < lines.length; i += perHalf) chunks.push(lines.slice(i, i + perHalf));
  return chunks;
}
