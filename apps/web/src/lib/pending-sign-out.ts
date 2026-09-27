/**
 * A sign-out the server never heard about (Q80). The refresh cookie is HttpOnly, so when
 * `POST /api/auth/logout` fails this device cannot delete it; without this mark the next page load
 * would exchange it for a new session and sign the user straight back in. The mark is a flag, never
 * a token (§10.1 S7): it only tells this browser not to use the cookie and to retry the sign-out.
 */
const KEY = 'pallet.signOutPending.v1';

export function hasPendingSignOut(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markSignOutPending(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Storage disabled: the server-side session then lasts until the cookie expires, as before.
  }
}

export function clearPendingSignOut(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
