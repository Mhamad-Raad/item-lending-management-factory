import { ERROR_CODES, type ApiFieldError, type ErrorCode } from '@pallet/shared';

/**
 * The only exception type services throw for expected failures. Carries a stable code
 * (never prose); ApiExceptionFilter turns it into the standard error body.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
    readonly fields?: ApiFieldError[],
  ) {
    super(code);
    this.name = 'ApiError';
    this.status = ERROR_CODES[code];
  }
}
