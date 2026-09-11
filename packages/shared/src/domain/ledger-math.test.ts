import { describe, expect, it } from 'vitest';
import {
  checkCreditLimit,
  chunkReceiptLines,
  computeOrderTotals,
  returnMoney,
  returnRefundDue,
  type LedgerEntryState,
  type OrderState,
  type ReturnState,
} from './ledger-math.js';
import type { PaymentType } from '../enums.js';

/**
 * Minimal in-memory simulator of the order/return/payment operations, used to replay the
 * worked examples of ARCHITECTURE.md section 4 against the pure formulas.
 */
interface SimReturn extends ReturnState {
  cashRefund: number;
  refundEntryIndex: number | null;
}

class SimOrder {
  readonly state: {
    cancelled: boolean;
    lines: { id: number; quantity: number; unitDeposit: number }[];
    returns: SimReturn[];
    ledger: LedgerEntryState[];
  };

  constructor(
    readonly paymentType: PaymentType,
    lines: [quantity: number, unitDeposit: number][],
  ) {
    this.state = {
      cancelled: false,
      lines: lines.map(([quantity, unitDeposit], i) => ({ id: i + 1, quantity, unitDeposit })),
      returns: [],
      ledger: [],
    };
    const depositTotal = this.totals().depositTotal;
    if (paymentType === 'CASH' && depositTotal > 0) this.state.ledger.push({ type: 'PAYMENT', amount: depositTotal });
  }

  totals() {
    return computeOrderTotals(this.state as OrderState);
  }

  pay(amount: number) {
    expect(this.paymentType).toBe('LENT');
    expect(amount).toBeLessThanOrEqual(this.totals().owed);
    this.state.ledger.push({ type: 'PAYMENT', amount });
  }

  /** entries: [lineId, accepted, damaged, damagedRefund] */
  recordReturn(entries: [number, number, number, number][]) {
    const lines = entries.map(([orderLineId, acceptedQuantity, damagedQuantity, damagedRefund]) => ({
      orderLineId,
      acceptedQuantity,
      damagedQuantity,
      damagedRefund,
    }));
    const refundDue = returnRefundDue(
      lines.map((l) => ({ ...l, unitDeposit: this.state.lines.find((ol) => ol.id === l.orderLineId)!.unitDeposit })),
    );
    const owedBefore = this.totals().owed;
    const { cashRefund, owedAfter } = returnMoney(owedBefore, refundDue);
    let refundEntryIndex: number | null = null;
    if (cashRefund > 0) {
      refundEntryIndex = this.state.ledger.push({ type: 'REFUND', amount: cashRefund }) - 1;
    }
    this.state.returns.push({ reversed: false, lines, cashRefund, refundEntryIndex });
    return { refundDue, owedBefore, cashRefund, owedAfter, index: this.state.returns.length - 1 };
  }

  deleteReturn(index: number) {
    const ret = this.state.returns[index]!;
    ret.reversed = true;
    if (ret.cashRefund > 0) this.state.ledger.push({ type: 'REFUND_REVERSAL', amount: ret.cashRefund });
  }

  /**
   * CASH line edit: reverse the automatic payment and record a new one (skipping zero amounts).
   * Like the API, ledger rows are written first and totals are recomputed once at the end
   * (the intermediate state with new lines but old payments is never evaluated).
   */
  editLines(lines: [quantity: number, unitDeposit: number][]) {
    const oldTotal = this.totals().depositTotal;
    const newTotal = lines.reduce((acc, [quantity, unitDeposit]) => acc + quantity * unitDeposit, 0);
    this.state.lines = lines.map(([quantity, unitDeposit], i) => ({ id: i + 1, quantity, unitDeposit }));
    if (this.paymentType === 'CASH') {
      if (oldTotal > 0) this.state.ledger.push({ type: 'PAYMENT_REVERSAL', amount: oldTotal });
      if (newTotal > 0) this.state.ledger.push({ type: 'PAYMENT', amount: newTotal });
    }
    return newTotal - oldTotal;
  }

  cancel() {
    const auto = this.state.ledger.find((e) => e.type === 'PAYMENT');
    if (this.paymentType === 'CASH' && auto) this.state.ledger.push({ type: 'PAYMENT_REVERSAL', amount: auto.amount });
    this.state.cancelled = true;
  }
}

describe('section 4.3 worked examples', () => {
  it('1. CASH 100×1,000, return 100 accepted → full cash refund, SETTLED', () => {
    const o = new SimOrder('CASH', [[100, 1000]]);
    const r = o.recordReturn([[1, 100, 0, 0]]);
    expect(r).toMatchObject({ refundDue: 100_000, owedBefore: 0, cashRefund: 100_000, owedAfter: 0 });
    expect(o.totals()).toMatchObject({ owed: 0, outValue: 0, held: 0, status: 'SETTLED' });
  });

  it('2. CASH 100×1,000, return 90 accepted + 10 damaged (refund 0) → compensation 10,000', () => {
    const o = new SimOrder('CASH', [[100, 1000]]);
    const r = o.recordReturn([[1, 90, 10, 0]]);
    expect(r).toMatchObject({ refundDue: 90_000, cashRefund: 90_000, owedAfter: 0 });
    expect(o.totals()).toMatchObject({ owed: 0, compensation: 10_000, status: 'SETTLED' });
  });

  it('3. LENT 100×1,000, return 90 accepted + 10 damaged → still owes 10,000', () => {
    const o = new SimOrder('LENT', [[100, 1000]]);
    const r = o.recordReturn([[1, 90, 10, 0]]);
    expect(r).toMatchObject({ refundDue: 90_000, owedBefore: 100_000, cashRefund: 0, owedAfter: 10_000 });
    expect(o.totals()).toMatchObject({ owed: 10_000, outValue: 0, held: 0, compensation: 10_000, status: 'OPEN' });
  });

  it('4. LENT 100×1,000, return 0 accepted + 50 damaged → owes 100,000', () => {
    const o = new SimOrder('LENT', [[100, 1000]]);
    const r = o.recordReturn([[1, 0, 50, 0]]);
    expect(r).toMatchObject({ refundDue: 0, cashRefund: 0, owedAfter: 100_000 });
    expect(o.totals()).toMatchObject({ owed: 100_000, outValue: 50_000, held: 0, status: 'OPEN' });
  });

  it('5+6. LENT 100×1,000, pay 40,000, return 50 then the remaining 50', () => {
    const o = new SimOrder('LENT', [[100, 1000]]);
    o.pay(40_000);
    const r1 = o.recordReturn([[1, 50, 0, 0]]);
    expect(r1).toMatchObject({ refundDue: 50_000, owedBefore: 60_000, cashRefund: 0, owedAfter: 10_000 });
    expect(o.totals()).toMatchObject({ owed: 10_000, outValue: 50_000, held: 40_000, status: 'OPEN' });

    const r2 = o.recordReturn([[1, 50, 0, 0]]);
    expect(r2).toMatchObject({ refundDue: 50_000, owedBefore: 10_000, cashRefund: 40_000, owedAfter: 0 });
    expect(o.totals()).toMatchObject({ owed: 0, outValue: 0, held: 0, status: 'SETTLED' });
  });

  it('7. CASH 100×1,000 line edited to 60×1,000 → automatic payment re-issued', () => {
    const o = new SimOrder('CASH', [[100, 1000]]);
    const delta = o.editLines([[60, 1000]]);
    expect(delta).toBe(-40_000); // stock +40 via ORDER_LINE_EDIT
    expect(o.state.ledger).toEqual([
      { type: 'PAYMENT', amount: 100_000 },
      { type: 'PAYMENT_REVERSAL', amount: 100_000 },
      { type: 'PAYMENT', amount: 60_000 },
    ]);
    expect(o.totals()).toMatchObject({ depositTotal: 60_000, paymentsNet: 60_000, owed: 0 });
  });

  it('8. CASH 100×1,000, return 50 accepted then deleted → REFUND_REVERSAL, OPEN', () => {
    const o = new SimOrder('CASH', [[100, 1000]]);
    const r = o.recordReturn([[1, 50, 0, 0]]);
    expect(r.cashRefund).toBe(50_000);
    o.deleteReturn(r.index);
    expect(o.state.ledger.at(-1)).toEqual({ type: 'REFUND_REVERSAL', amount: 50_000 });
    expect(o.totals()).toMatchObject({ owed: 0, outValue: 100_000, held: 100_000, status: 'OPEN' });
  });

  it('9. cancelled order → every derived value is zero', () => {
    const o = new SimOrder('CASH', [[100, 1000]]);
    o.cancel();
    expect(o.totals()).toMatchObject({ outValue: 0, owed: 0, held: 0, compensation: 0, status: 'CANCELLED' });
    expect(o.totals().lines[0]!.outQuantity).toBe(0);
  });
});

describe('ordering rule: deleting an earlier return never recomputes a later cash refund', () => {
  it('CASH 100×1,000: returns of 50 and 50, then delete the first', () => {
    const o = new SimOrder('CASH', [[100, 1000]]);
    const a = o.recordReturn([[1, 50, 0, 0]]);
    const b = o.recordReturn([[1, 50, 0, 0]]);
    expect([a.cashRefund, b.cashRefund]).toEqual([50_000, 50_000]);
    o.deleteReturn(a.index);
    expect(o.totals()).toMatchObject({ owed: 0, outValue: 50_000, held: 50_000, status: 'OPEN' });
  });

  it('return edit = delete + re-apply against the current state', () => {
    const o = new SimOrder('LENT', [[100, 1000]]);
    const first = o.recordReturn([[1, 60, 0, 0]]); // owes 40,000
    expect(first.owedAfter).toBe(40_000);
    o.deleteReturn(first.index); // owes 100,000 again
    const replacement = o.recordReturn([[1, 50, 5, 2_000]]);
    expect(replacement).toMatchObject({ refundDue: 52_000, owedBefore: 100_000, cashRefund: 0, owedAfter: 48_000 });
    expect(o.totals()).toMatchObject({ owed: 48_000, outValue: 45_000, held: 0, compensation: 3_000 });
  });
});

describe('credit limit (4.4)', () => {
  it('allows when there is no limit or the delta is not positive', () => {
    expect(checkCreditLimit({ creditLimit: null, customerOutValue: 9e9, depositDelta: 1 }).allowed).toBe(true);
    expect(checkCreditLimit({ creditLimit: 0, customerOutValue: 0, depositDelta: 0 }).allowed).toBe(true);
    expect(checkCreditLimit({ creditLimit: 0, customerOutValue: 50_000, depositDelta: -10_000 }).allowed).toBe(true);
  });

  it('blocks with the excess when the limit would be exceeded', () => {
    expect(checkCreditLimit({ creditLimit: 500_000, customerOutValue: 450_000, depositDelta: 100_000 })).toEqual({
      allowed: false,
      excess: 50_000,
    });
    expect(checkCreditLimit({ creditLimit: 500_000, customerOutValue: 400_000, depositDelta: 100_000 }).allowed).toBe(
      true,
    );
  });
});

describe('receipt chunking (A15)', () => {
  it('splits into chunks of 6 and keeps one sheet for an empty order', () => {
    expect(chunkReceiptLines([])).toEqual([[]]);
    expect(chunkReceiptLines([1, 2, 3, 4, 5, 6]).length).toBe(1);
    expect(chunkReceiptLines([1, 2, 3, 4, 5, 6, 7]).map((c) => c.length)).toEqual([6, 1]);
  });
});
