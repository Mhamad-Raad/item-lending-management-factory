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

describe('a refresh overtaken by a sign-out (Q136)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('drops its answer: the session that ended stays ended', async () => {
    const user = {
      id: 1,
      username: 'admin',
      displayName: 'Admin',
      role: 'ADMIN' as const,
      mustChangePassword: false,
      permissions: [],
      version: 1,
    };
    const expiry = new Date(Date.now() + 900_000).toISOString();
    authStore.setSession({ accessToken: 'token-1', accessTokenExpiresAt: expiry, user });
    let answer: (response: Response) => void = () => undefined;
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    );

    const refreshing = refreshAccessToken();
    // The idle limit, or the user, ends the session while the refresh is still on its way.
    authStore.clear();
    answer(
      new Response(JSON.stringify({ accessToken: 'token-2', accessTokenExpiresAt: expiry, user }), { status: 200 }),
    );

    await expect(refreshing).resolves.toBe(false);
    expect(authStore.getSnapshot().status).toBe('anonymous');
    expect(authStore.token).toBeNull();
  });

  it('is not handed to the session that follows: that one asks for a refresh of its own', async () => {
    const user = {
      id: 1,
      username: 'admin',
      displayName: 'Admin',
      role: 'ADMIN' as const,
      mustChangePassword: false,
      permissions: [],
      version: 1,
    };
    const expiry = new Date(Date.now() + 900_000).toISOString();
    const body = (token: string): string => JSON.stringify({ accessToken: token, accessTokenExpiresAt: expiry, user });
    authStore.setSession({ accessToken: 'old-1', accessTokenExpiresAt: expiry, user });
    let answerOld: (response: Response) => void = () => undefined;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          answerOld = resolve;
        }),
      )
      .mockResolvedValueOnce(new Response(body('new-2'), { status: 200 }));

    const old = refreshAccessToken();
    // The session ends and the user signs in again while the first refresh is still out.
    authStore.clear();
    authStore.setSession({ accessToken: 'new-1', accessTokenExpiresAt: expiry, user });

    await expect(refreshAccessToken()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authStore.token).toBe('new-2');

    // The late answer of the first changes nothing.
    answerOld(new Response(body('old-2'), { status: 200 }));
    await expect(old).resolves.toBe(false);
    expect(authStore.token).toBe('new-2');
    authStore.clear();
  });
});
