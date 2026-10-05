/**
 * What the idle sign-out (Q136) shares between the tabs of one browser, and keeps across a reload: when the user
 * last did something, and that the last session ended for inactivity. Two plain values, never a token (§10.1 S7).
 */
export const ACTIVITY_KEY = 'pallet.lastActivity.v1';
const NOTICE_KEY = 'pallet.idleSignedOut.v1';

/** The moment of the last activity in any tab, or null when none is on record (signed out, or storage disabled). */
export function readLastActivity(): number | null {
  try {
    const at = Number(localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

export function writeLastActivity(at: number): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    // Storage disabled: each tab then counts its own idle time, and the server's limit covers a reopened browser.
  }
}

export function clearLastActivity(): void {
  try {
    localStorage.removeItem(ACTIVITY_KEY);
  } catch {
    // Nothing stored.
  }
}

/** The login page says why the user is looking at it. */
export function hasIdleNotice(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIdleNotice(): void {
  try {
    localStorage.setItem(NOTICE_KEY, '1');
  } catch {
    // Storage disabled: the login page shows without the explanation.
  }
}

export function clearIdleNotice(): void {
  try {
    localStorage.removeItem(NOTICE_KEY);
  } catch {
    // Nothing stored.
  }
}
