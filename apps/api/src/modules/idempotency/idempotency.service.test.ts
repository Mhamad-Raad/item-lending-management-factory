import { describe, expect, it } from 'vitest';
import type { Clock } from '../../common/clock';
import type { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from './idempotency.service';

/** `requestHash` touches neither the database nor the clock. */
const service = new IdempotencyService(undefined as unknown as PrismaService, undefined as unknown as Clock);

describe('U11: idempotency request hash (§6.7 step 2)', () => {
  it('ignores the order of object keys', () => {
    expect(service.requestHash('POST', '/api/orders', { a: 1, b: { c: 2, d: 3 } })).toBe(
      service.requestHash('POST', '/api/orders', { b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it('keeps the order of arrays significant', () => {
    expect(service.requestHash('POST', '/api/orders', { lines: [1, 2] })).not.toBe(
      service.requestHash('POST', '/api/orders', { lines: [2, 1] }),
    );
  });

  it('includes the method and the concrete path', () => {
    const body = { amount: 1_000 };
    const hash = service.requestHash('POST', '/api/orders/12/payments', body);

    expect(service.requestHash('POST', '/api/orders/13/payments', body)).not.toBe(hash);
    expect(service.requestHash('PUT', '/api/orders/12/payments', body)).not.toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
