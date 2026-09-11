import type { AuthTokenDto, LoginBody, MeDto, PermissionKey } from '@pallet/shared';
import { useSyncExternalStore } from 'react';
import { apiFetch } from './api-client';
import { authStore } from './auth-store';
import { listenForPeerRefreshes, refreshAccessToken } from './refresh-lock';

/** Refresh this long before the access token expires, while the tab is visible. */
const REFRESH_MARGIN_MS = 60_000;
/**
 * A floor under the timer. A client clock running far ahead of the server would otherwise compute
 * a delay of zero on every refresh and spin, rotating the cookie until the throttler stops it.
 */
const MIN_REFRESH_DELAY_MS = 10_000;

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleProactiveRefresh(): void {
  clearTimeout(refreshTimer);
  const { accessTokenExpiresAt } = authStore.getSnapshot();
  if (!accessTokenExpiresAt) return;

  const delay = accessTokenExpiresAt - Date.now() - REFRESH_MARGIN_MS;
  refreshTimer = setTimeout(
    () => {
      if (document.visibilityState === 'visible') void refreshAccessToken();
    },
    Math.max(MIN_REFRESH_DELAY_MS, delay),
  );
}

/**
 * Restores the session on a full page load: the refresh cookie is the only thing that survives a
 * reload, so the app asks for a fresh access token before it renders anything.
 */
export async function bootstrapAuth(): Promise<void> {
  listenForPeerRefreshes();
  authStore.subscribe(scheduleProactiveRefresh);

  document.addEventListener('visibilitychange', () => {
    const { accessTokenExpiresAt, status } = authStore.getSnapshot();
    if (document.visibilityState !== 'visible' || status !== 'authenticated' || !accessTokenExpiresAt) return;
    if (accessTokenExpiresAt - Date.now() < REFRESH_MARGIN_MS) void refreshAccessToken();
  });

  if (!(await refreshAccessToken())) authStore.clear();
}

export async function login(body: LoginBody): Promise<MeDto> {
  const session = await apiFetch<AuthTokenDto>('/auth/login', { method: 'POST', body, skipAuthRetry: true });
  authStore.setSession(session);
  return session.user;
}

/** Always ends anonymous, even if the request fails: the user asked to be signed out. */
export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST', skipAuthRetry: true });
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
