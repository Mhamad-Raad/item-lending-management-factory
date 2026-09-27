// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAuth, logout } from './auth';
import { authStore } from './auth-store';
import { refreshAccessToken } from './refresh-lock';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bootstrapAuth (Q79)', () => {
  it('keeps the session undecided when the server cannot be reached, so the user can retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('failed to fetch'));

    await expect(bootstrapAuth()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    // Not "anonymous": that would send the user to the login page while the refresh cookie is still good.
    expect(authStore.getSnapshot().status).toBe('booting');
  });

  it('starts signed out when the refresh endpoint answers a 4xx no retry would change', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'ROUTE_NOT_FOUND' } }), { status: 404 }),
    );

    await expect(bootstrapAuth()).resolves.toBeUndefined();
    expect(authStore.getSnapshot().status).toBe('anonymous');
  });

  it('signs out when the server refuses the refresh cookie', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'AUTH_REFRESH_INVALID' } }), { status: 401 }),
    );

    await expect(bootstrapAuth()).resolves.toBeUndefined();
    expect(authStore.getSnapshot().status).toBe('anonymous');
  });
});

describe('a sign-out the server missed (Q80)', () => {
  const session = {
    accessToken: 'token-1',
    accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: 1,
      username: 'admin',
      displayName: 'Admin',
      role: 'ADMIN' as const,
      mustChangePassword: false,
      permissions: [],
      version: 1,
    },
  };

  afterEach(() => {
    localStorage.clear();
  });

  it('signs this device out, rethrows, and keeps the leftover cookie from signing it back in', async () => {
    authStore.setSession(session);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('failed to fetch'));

    await expect(logout()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(authStore.getSnapshot().status).toBe('anonymous');

    // Another tab, or the next page load, must not exchange the cookie for a session.
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(refreshAccessToken()).resolves.toBe(false);
    await bootstrapAuth();
    expect(authStore.getSnapshot().status).toBe('anonymous');
    // The page load retried the sign-out instead of refreshing.
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).not.toContain('/api/auth/refresh');
    expect(urls.at(-1)).toBe('/api/auth/logout');
    await vi.waitFor(() => expect(localStorage.length).toBe(0));
  });

  it('a successful sign-out leaves nothing behind', async () => {
    authStore.setSession(session);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(logout()).resolves.toBeUndefined();
    expect(localStorage.length).toBe(0);
  });
});
