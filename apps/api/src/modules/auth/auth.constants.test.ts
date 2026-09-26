import { describe, expect, it } from 'vitest';
import { accountThrottleDurationMs, lockoutDurationMs } from './auth.constants';

describe('lockoutDurationMs', () => {
  it('U14: doubles each lockout and stops at fifteen minutes', () => {
    const minutes = [0, 1, 2, 3, 4, 5].map((count) => lockoutDurationMs(count) / 60_000);

    expect(minutes).toEqual([1, 2, 4, 8, 15, 15]);
  });
});

describe('accountThrottleDurationMs', () => {
  it('doubles from five minutes and stops at an hour (Q68)', () => {
    const minutes = [0, 1, 2, 3, 4, 5].map((count) => accountThrottleDurationMs(count) / 60_000);

    expect(minutes).toEqual([5, 10, 20, 40, 60, 60]);
  });
});
