/** Session and cookie constants (§6.8, §10.1 S10–S12). */

export const REFRESH_COOKIE_NAME = 'pallet_rt';
/** The cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/auth';

export const ACCESS_TOKEN_TTL = '15m';
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Sliding lifetime of one refresh token. */
export const REFRESH_SLIDING_MS = 14 * 24 * 60 * 60 * 1000;
/** Absolute lifetime of a session family, however often it is rotated. */
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
/** A rotated token keeps working this long, for two tabs refreshing at once. */
export const REFRESH_GRACE_MS = 30 * 1000;

/** Login throttle (§6.8.2): five failures in a fifteen-minute window locks the (ip, username) pair. */
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;
export const LOCKOUT_BASE_MS = 60 * 1000;
export const LOCKOUT_MAX_MS = 15 * 60 * 1000;

/** Lock durations go 1, 2, 4, 8, 15, 15 … minutes. */
export function lockoutDurationMs(lockoutCount: number): number {
  return Math.min(LOCKOUT_MAX_MS, LOCKOUT_BASE_MS * 2 ** lockoutCount);
}
