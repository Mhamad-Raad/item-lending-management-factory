import {
  ACCESS_TOKEN_TTL_MINUTES,
  type AuthTokenDto,
  type LoginBody,
  type MeDto,
  type PermissionKey,
} from '@pallet/shared';
import { useSyncExternalStore } from 'react';
import { apiFetch } from './api-client';
import { authStore } from './auth-store';
import { endSharedRecord, idleLimitReached, startActivity, wasLeftIdle, watchForIdleness } from './idle';
import { clearIdleNotice, markIdleNotice } from './idle-storage';
import { clearPendingSignOut, hasPendingSignOut, markSignOutPending } from './pending-sign-out';
import { listenForPeerRefreshes, refreshAccessToken } from './refresh-lock';

/** Refresh this long before the access token expires, while the tab is visible. */
const REFRESH_MARGIN_MS = 60_000;
/**
 * A floor under the timer. A client clock running far ahead of the server would otherwise compute
 * a delay of zero on every refresh and spin, rotating the cookie until the throttler stops it.
 */
const MIN_REFRESH_DELAY_MS = 10_000;
/**
 * A ceiling over it, from the token's known life rather than from two clocks: a client clock running behind the
 * server would otherwise put the refresh off past the expiry, and past the server's idle limit (Q136).
 */
const MAX_REFRESH_DELAY_MS = ACCESS_TOKEN_TTL_MINUTES * 60_000 - REFRESH_MARGIN_MS;
/** A refresh that was not made — the server out of reach, the idle limit just reached — is tried again this soon. */
const REFRESH_RETRY_MS = 30_000;

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let bootstrapped = false;
let onIdleSignOut: (() => void) | undefined;
/**
 * A sign-out's request to the server while it is still out — the idle one, or the retry of one the server missed
 * (Q80). A sign-in waits for it (see `login`), and a page load does not send another meanwhile.
 */
let signOutRequest: Promise<void> | undefined;

/** Tells the server the session is over, once at a time; until it answers, the sign-out counts as pending (Q80). */
function tellServerSignedOut(): void {
  if (signOutRequest) return;
  const told = apiFetch<void>('/auth/logout', { method: 'POST', skipAuthRetry: true }).then(
    clearPendingSignOut,
    () => undefined,
  );
  signOutRequest = told;
  void told.finally(() => {
    if (signOutRequest === told) signOutRequest = undefined;
  });
}

/** Where the app goes once an idle session has been ended (Q136): the login page, set by `App`. */
export function setIdleSignOutHandler(handler: () => void): void {
  onIdleSignOut = handler;
}

/**
 * Ends a session nobody has touched for the idle limit (Q136). The screen goes first — what is on it is no longer
 * anyone's, and the server may take its time — then the server is told, so the cookie left in the browser is worth
 * nothing. Until it answers the sign-out counts as one it has not heard of (Q80): a reload in between must not use
 * the cookie.
 */
function signOutForInactivity(): void {
  markIdleNotice();
  markSignOutPending();
  tellServerSignedOut();
  endSharedRecord();
  authStore.clear();
  onIdleSignOut?.();
}

/** Another tab ended the session this one shares with it: this tab follows, without a request of its own. */
function followSignOutElsewhere(): void {
  authStore.clear();
  onIdleSignOut?.();
}

/**
 * A refresh ahead of expiry. A failure here says nothing the user must act on: a refusal surfaces on
 * the next request (its 401 ends the session), and an unreachable server is retried by that request.
 */
function refreshQuietly(): void {
  // Nobody is there (Q136): the session is about to be ended, not renewed — unless the user answers in the moment
  // before it is, so the refresh is put off rather than dropped.
  if (idleLimitReached()) return retryRefreshSoon();
  // Out of reach, not refused: tried again, since the session must not lapse for a blip.
  refreshAccessToken().catch(retryRefreshSoon);
}

/** The timer is set from the store; when the store did not change, it is set again here. */
function retryRefreshSoon(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (document.visibilityState === 'visible' && authStore.getSnapshot().status === 'authenticated') refreshQuietly();
  }, REFRESH_RETRY_MS);
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
    Math.min(MAX_REFRESH_DELAY_MS, Math.max(MIN_REFRESH_DELAY_MS, delay)),
  );
}

/**
 * Restores the session on a full page load: the refresh cookie is the only thing that survives a
 * reload, so the app asks for a fresh access token before it renders anything. A refusal leaves the
 * user signed out; a server out of reach rejects with its ApiError and the cookie stays (Q79).
 */
export async function bootstrapAuth(): Promise<void> {
  // Once per page load: a retry after a failed restore runs this again, and must not register the listeners twice.
  if (!bootstrapped) {
    bootstrapped = true;
    listenForPeerRefreshes();
    watchForIdleness({ expire: signOutForInactivity, endedElsewhere: followSignOutElsewhere });
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
    // Not a second time while one is still on its way: React's development double effect restores twice at once,
    // and the second restore finds the first one's idle sign-out pending.
    authStore.clear();
    tellServerSignedOut();
    return;
  }
  if (wasLeftIdle()) {
    // The browser was closed, or the device slept, past the idle limit (Q136): the session is ended rather
    // than restored, and the login page says why.
    signOutForInactivity();
    return;
  }
  if (await refreshAccessToken()) {
    // Opening the app is being there: the count starts again, also when a record of a moment ago exists.
    startActivity();
  } else {
    endSharedRecord();
    authStore.clear();
  }
}

export async function login(body: LoginBody): Promise<MeDto> {
  // A sign-out may still be on its way to the server — an idle one (Q136), or the retry of one it missed (Q80). Its
  // answer clears the refresh cookie, and arriving after this sign-in's it would clear the new one: the two are
  // sent one after the other.
  await signOutRequest;
  const session = await apiFetch<AuthTokenDto>('/auth/login', { method: 'POST', body, skipAuthRetry: true });
  // A fresh sign-in replaces the cookie a failed sign-out left behind.
  clearPendingSignOut();
  clearIdleNotice();
  startActivity();
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
    endSharedRecord();
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
    endSharedRecord();
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
