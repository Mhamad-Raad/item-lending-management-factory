import { describe, expect, it } from 'vitest';
import { standingCreditRefusal, type ServerCreditRefusal } from './order-text';

const refusal: ServerCreditRefusal = {
  customerId: 7,
  creditLimit: 100_000,
  customerOutValue: 90_000,
  depositDelta: 20_000,
  excess: 10_000,
};

describe('standingCreditRefusal', () => {
  it('holds for the customer and total the server refused', () => {
    expect(standingCreditRefusal(refusal, 7, 20_000)).toBe(refusal);
  });

  it('lapses when another customer is picked, even for the same total', () => {
    expect(standingCreditRefusal(refusal, 8, 20_000)).toBeNull();
    expect(standingCreditRefusal(refusal, null, 20_000)).toBeNull();
  });

  it('lapses when the total changes', () => {
    expect(standingCreditRefusal(refusal, 7, 19_000)).toBeNull();
  });

  it('is nothing without a refusal', () => {
    expect(standingCreditRefusal(null, 7, 20_000)).toBeNull();
  });
});
