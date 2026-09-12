import { canonicalJson } from '@pallet/shared';
import { useCallback, useRef } from 'react';

/**
 * The client half of §6.7 (§7.7.6): one key per submission of one payload. The same payload sent again
 * — a double click, a network retry — reuses the key and gets the original result; a changed payload,
 * such as a correction or `confirmCreditOverride: true`, gets a new key. `reset` drops the key after a
 * success, so the next order is a new submission.
 */
export function useIdempotencyKey(): { getKey: (payload: unknown) => string; reset: () => void } {
  const stored = useRef<{ key: string; payloadHash: string } | null>(null);

  const getKey = useCallback((payload: unknown): string => {
    const payloadHash = canonicalJson(payload);
    if (stored.current?.payloadHash !== payloadHash) {
      stored.current = { key: crypto.randomUUID(), payloadHash };
    }
    return stored.current.key;
  }, []);

  const reset = useCallback((): void => {
    stored.current = null;
  }, []);

  return { getKey, reset };
}
