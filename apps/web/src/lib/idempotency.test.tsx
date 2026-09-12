// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useIdempotencyKey } from './idempotency';

describe('useIdempotencyKey', () => {
  it('reuses the key for the same payload, whatever its key order, and makes a new one for a change', () => {
    const { result } = renderHook(() => useIdempotencyKey());

    const first = result.current.getKey({ customerId: 1, lines: [{ itemId: 2, quantity: 5 }] });
    expect(result.current.getKey({ lines: [{ quantity: 5, itemId: 2 }], customerId: 1 })).toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,100}$/);

    const corrected = result.current.getKey({ customerId: 1, lines: [{ itemId: 2, quantity: 6 }] });
    expect(corrected).not.toBe(first);
  });

  it('starts a new submission after a reset', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const payload = { customerId: 1 };
    const first = result.current.getKey(payload);

    result.current.reset();

    expect(result.current.getKey(payload)).not.toBe(first);
  });
});
