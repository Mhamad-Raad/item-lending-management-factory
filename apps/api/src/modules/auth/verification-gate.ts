import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors/api-error';
import { Semaphore, SemaphoreBusyError } from '../../common/utils/semaphore';

/**
 * Process-wide cap on concurrent password checks (Q123). Login and change-password verify inside their
 * transaction, under their locks (Q69), so each check holds one of the pool's 20 connections for the length of
 * an Argon2 verification: a flood of sign-ins from many addresses could take every connection and stall the
 * whole API. At most eight run at once; the rest wait, holding no connection, and after a few seconds — or when
 * the queue is long — are refused with `RATE_LIMITED`, which the login page already explains.
 */
export const MAX_CONCURRENT_VERIFICATIONS = 8;
export const VERIFICATION_QUEUE_LIMIT = 100;
export const VERIFICATION_MAX_WAIT_MS = 5_000;

@Injectable()
export class VerificationGate {
  private readonly semaphore = new Semaphore({
    permits: MAX_CONCURRENT_VERIFICATIONS,
    maxQueue: VERIFICATION_QUEUE_LIMIT,
    maxWaitMs: VERIFICATION_MAX_WAIT_MS,
  });

  /** Runs `work` — the whole transaction that verifies — once a slot is free. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await this.semaphore.run(work);
    } catch (error) {
      if (error instanceof SemaphoreBusyError) throw new ApiError('RATE_LIMITED', { retryAfterSeconds: 5 });
      throw error;
    }
  }
}
