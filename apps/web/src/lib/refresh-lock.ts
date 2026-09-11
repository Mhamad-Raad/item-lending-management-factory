import type { AuthTokenDto } from '@pallet/shared';
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

async function doRefresh(): Promise<boolean> {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-Requested-With': 'pallet-web' },
    credentials: 'same-origin',
  }).catch(() => null);

  if (!response?.ok) return false;

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
 * Refreshes the access token at most once at a time in this tab, and — through the Web Locks API
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
