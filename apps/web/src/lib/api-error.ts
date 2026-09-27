import type { ApiErrorBody, ApiFieldError, ErrorCode, ErrorDetailsByCode } from '@pallet/shared';

/** Codes the client itself produces; the server never sends them. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'REQUEST_TIMEOUT' | 'UNKNOWN_ERROR';

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

/** Statuses a proxy answers with, without our JSON body, while the API is restarting or down. */
const UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

/**
 * The ApiError a failed response stands for. A body without our error shape — Caddy's own 502 while
 * the API restarts, say — still becomes a code the UI can translate rather than a raw status.
 */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiError(body.error.code, response.status, body.error.details, body.error.fields, body.requestId);
  } catch {
    return new ApiError(
      UNAVAILABLE_STATUSES.has(response.status) ? 'SERVICE_UNAVAILABLE' : 'UNKNOWN_ERROR',
      response.status,
    );
  }
}

/**
 * The typed `details` of `error` when it is an ApiError with `code`, else null: one checked place for
 * what each code carries (`ErrorDetailsByCode` in @pallet/shared) instead of a cast at every call site.
 */
export function detailsOf<C extends keyof ErrorDetailsByCode>(error: unknown, code: C): ErrorDetailsByCode[C] | null {
  if (!(error instanceof ApiError) || error.code !== code || !error.details) return null;
  return error.details as unknown as ErrorDetailsByCode[C];
}
