/** How long a request may wait for the server's answer before the user is told (Q88). */
export const REQUEST_TIMEOUT_MS = 30_000;
/** An image upload over a slow phone connection needs longer. */
export const UPLOAD_TIMEOUT_MS = 120_000;

export interface TimedSignal {
  signal: AbortSignal;
  /** True once the time ran out (as opposed to the caller cancelling). */
  timedOut: () => boolean;
  /** Stops the clock once the answer has arrived. */
  clear: () => void;
}

/**
 * An abort signal that fires after `ms`, or when `outer` (the caller's own signal) does. Built by hand
 * rather than with `AbortSignal.any`/`AbortSignal.timeout`, which older phone browsers lack.
 */
export function timedSignal(ms: number, outer?: AbortSignal): TimedSignal {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  const forward = (): void => controller.abort(outer?.reason);
  if (outer?.aborted) forward();
  else outer?.addEventListener('abort', forward, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => expired,
    clear: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', forward);
    },
  };
}
