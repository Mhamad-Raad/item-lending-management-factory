import type { AuthTokenDto } from '@pallet/shared';
import { ApiError, apiErrorFromResponse } from './api-error';
import { authStore } from './auth-store';

const REFRESH_CHANNEL = 'pallet-auth';
const PEER_BUSY_MS = 3_000;

let inflight: Promise<boolean> | null = null;
let peerBusyUntil = 0;
let channel: BroadcastChannel | null = null;

interface PeerMessage {
  type: 'refresh-start' | 'refresh-end';
  at: number;
}

function peerChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  channel ??= new BroadcastChannel(REFRESH_CHANNEL);
  return channel;
}

/** Listens for other tabs so this one can wait rather than rotate the cookie at the same moment. */
export function listenForPeerRefreshes(): void {
  const peers = peerChannel();
  if (!peers) return;
  peers.onmessage = (event: MessageEvent<PeerMessage>) => {
    peerBusyUntil = event.data.type === 'refresh-start' ? event.data.at + PEER_BUSY_MS : 0;
  };
}

/**
 * True when the session was renewed, false when the server refused it (a 401: the cookie is missing,
 * expired, reused or revoked — the session is gone). Anything else — no connection, a 502 while the
 * API restarts, a rate limit — says nothing about the session, so it rejects with that ApiError and
 * the caller keeps the user signed in (Q79).
 */
async function doRefresh(): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-Requested-With': 'pallet-web' },
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 0);
  }

  if (response.status === 401) return false;
  if (!response.ok) throw await apiErrorFromResponse(response);

  authStore.setSession((await response.json()) as AuthTokenDto);
  return true;
}

async function waitForPeer(): Promise<void> {
  while (Date.now() < peerBusyUntil) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function refreshWithPeers(): Promise<boolean> {
  const peers = peerChannel();
  if (!peers) return doRefresh();

  await waitForPeer();
  peers.postMessage({ type: 'refresh-start', at: Date.now() } satisfies PeerMessage);
  try {
    return await doRefresh();
  } finally {
    peers.postMessage({ type: 'refresh-end', at: Date.now() } satisfies PeerMessage);
  }
}

/**
 * Resolves true (renewed) or false (refused: the session is gone), and rejects with an ApiError when
 * the server could not be asked. Refreshes the access token at most once at a time in this tab, and — through the Web Locks API
 * where it exists — one tab at a time across the whole browser, so rotating the refresh cookie
 * never races with itself. The server's 30 second grace window covers what the lock cannot.
 */
export function refreshAccessToken(): Promise<boolean> {
  inflight ??= (async () => {
    try {
      if (typeof navigator !== 'undefined' && 'locks' in navigator) {
        return await navigator.locks.request('pallet-auth-refresh', { mode: 'exclusive' }, () => doRefresh());
      }
      return await refreshWithPeers();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
