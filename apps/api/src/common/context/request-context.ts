import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  /** Pino request id, also returned as `X-Request-Id`. */
  requestId: string;
  /** `req.ip`, already resolved through Express `trust proxy`. */
  ip: string;
  userId: number | null;
}

const storage = new AsyncLocalStorage<RequestContextData>();

/**
 * Per-request data that cross-cutting services read instead of threading it through every
 * call signature (§11.1). Populated by `RequestContextMiddleware` (requestId, ip) and by
 * `AuthGuard` (userId); outside a request — scripts, jobs — `get()` returns undefined.
 */
export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },

  get(): RequestContextData | undefined {
    return storage.getStore();
  },

  setUserId(userId: number): void {
    const store = storage.getStore();
    if (store) store.userId = userId;
  },
} as const;
