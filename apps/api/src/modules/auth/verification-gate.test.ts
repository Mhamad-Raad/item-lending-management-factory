import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../common/errors/api-error';
import { Semaphore, SemaphoreBusyError } from '../../common/utils/semaphore';
import { VerificationGate } from './verification-gate';

/** Q123: a sign-in that cannot get a verification slot is told to retry, never left hanging. */
describe('VerificationGate', () => {
  it('answers RATE_LIMITED when the queue is full or the wait runs out', async () => {
    const gate = new VerificationGate();
    for (const reason of ['queue-full', 'timeout'] as const) {
      vi.spyOn(Semaphore.prototype, 'run').mockRejectedValueOnce(new SemaphoreBusyError(reason));
      const refused = await gate.run(() => Promise.resolve('never')).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(ApiError);
      expect(refused).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: 5 } });
    }
    vi.restoreAllMocks();
  });

  it('passes the work’s own result and errors through', async () => {
    const gate = new VerificationGate();
    await expect(gate.run(() => Promise.resolve(42))).resolves.toBe(42);
    await expect(gate.run(() => Promise.reject(new ApiError('AUTH_INVALID_CREDENTIALS')))).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
  });
});
