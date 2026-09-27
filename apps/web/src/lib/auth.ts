import type { AuthTokenDto, LoginBody, MeDto, PermissionKey } from '@pallet/shared';
import { useSyncExternalStore } from 'react';
import { apiFetch } from './api-client';
import { authStore } from './auth-store';
import { clearPendingSignOut, hasPendingSignOut, markSignOutPending } from './pending-sign-out';
import { listenForPeerRefreshes, refreshAccessToken } from './refresh-lock';

/** Refresh this long before the access token expires, while the tab is visible. */
const REFRESH_MARGIN_MS = 60_000;
/**
 * A floor under the timer. A client clock running far ahead of the server would otherwise compute
 * a delay of zero on every refresh and spin, rotating the cookie until the throttler stops it.
 */
const MIN_REFRESH_DELAY_MS = 10_000;

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let bootstrapped = false;

/**
 * A refresh ahead of expiry. A failure here says nothing the user must act on: a refusal surfaces on
 * the next request (its 401 ends the session), and an unreachable server is retried by that request.
 */
function refreshQuietly(): void {
  refreshAccessToken().catch(() => undefined);
}

function scheduleProactiveRefresh(): void {
  clearTimeout(refreshTimer);
  const { accessTokenExpiresAt } = authStore.getSnapshot();
  if (!accessTokenExpiresAt) return;

  const delay = accessTokenExpiresAt - Date.now() - REFRESH_MARGIN_MS;
  refreshTimer = setTimeout(
    () => {
      if (document.visibilityState === 'visible') refreshQuietly();
    },
    Math.max(MIN_REFRESH_DELAY_MS, delay),
  );
}

/**
 * Restores the session on a full page load: the refresh cookie is the only thing that survives a
 * reload, so the app asks for a fresh access token before it renders anything. A refusal leaves the
 * user signed out; a server out of reach rejects with its ApiError and the cookie stays (Q79).
 */
export async function bootstrapAuth(): Promise<void> {
  // Once per page load. React's development double-effect would otherwise register the listeners
  // twice and, harmlessly but pointlessly, refresh twice.
  if (!bootstrapped) {
    bootstrapped = true;
    listenForPeerRefreshes();
    authStore.subscribe(scheduleProactiveRefresh);
    document.addEventListener('visibilitychange', () => {
      const { accessTokenExpiresAt, status } = authStore.getSnapshot();
      if (document.visibilityState !== 'visible' || status !== 'authenticated' || !accessTokenExpiresAt) return;
      if (accessTokenExpiresAt - Date.now() < REFRESH_MARGIN_MS) refreshQuietly();
    });
  }

  if (hasPendingSignOut()) {
    // The user signed out while the server was out of reach (Q80): never use the leftover cookie,
    // and try once more to end its session on the server.
    authStore.clear();
    void apiFetch<void>('/auth/logout', { method: 'POST', skipAuthRetry: true }).then(
      clearPendingSignOut,
      () => undefined,
    );
    return;
  }
  if (!(await refreshAccessToken())) authStore.clear();
}

export async function login(body: LoginBody): Promise<MeDto> {
  const session = await apiFetch<AuthTokenDto>('/auth/login', { method: 'POST', body, skipAuthRetry: true });
  // A fresh sign-in replaces the cookie a failed sign-out left behind.
  clearPendingSignOut();
  authStore.setSession(session);
  return session.user;
}

/**
 * Always ends anonymous, even if the request fails: the user asked to be signed out. A failure is
 * rethrown so the page can say the server may still hold the session, and marked (Q80) so the
 * refresh cookie left behind cannot sign this device back in.
 */
export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST', skipAuthRetry: true });
    clearPendingSignOut();
  } catch (error) {
    markSignOutPending();
    throw error;
  } finally {
    authStore.clear();
  }
}

/**
 * Ends every session of the current user, this one included, then forgets it locally (§7.3.21). The user asked
 * to be signed out: this device forgets the session even when the request fails, and the failure is rethrown so
 * the page can say the other sessions may still be open.
 */
export async function logoutEverywhere(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout-all', { method: 'POST' });
    clearPendingSignOut();
  } catch (error) {
    markSignOutPending();
    throw error;
  } finally {
    authStore.clear();
  }
}

export async function refreshMe(): Promise<MeDto> {
  const me = await apiFetch<MeDto>('/auth/me');
  authStore.setUser(me);
  return me;
}

export function useAuth(): ReturnType<typeof authStore.getSnapshot> {
  return useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot);
}

export function useCan(key: PermissionKey): boolean {
  // Subscribed through useAuth so a permission change re-renders the navigation.
  useAuth();
  return authStore.can(key);
}

export { authStore };
