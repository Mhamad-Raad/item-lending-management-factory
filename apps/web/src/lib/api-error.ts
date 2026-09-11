import type { ApiFieldError, ErrorCode } from '@pallet/shared';

/** Codes the client itself produces; the server never sends them. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'UNKNOWN_ERROR';

/**
 * Every failed request becomes one of these, so callers never branch on HTTP status or parse a
 * body themselves. `code` is what the UI translates (`errors.<code>`); prose never crosses the
 * wire.
 */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | ClientErrorCode,
    readonly status: number,
    readonly details?: Record<string, unknown>,
    readonly fields?: ApiFieldError[],
    readonly requestId?: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }

  /** True for the 401s that a token refresh might fix. */
  get isAuthExpired(): boolean {
    return this.code === 'AUTH_TOKEN_EXPIRED' || this.code === 'AUTH_TOKEN_INVALID' || this.code === 'AUTH_REQUIRED';
  }
}
