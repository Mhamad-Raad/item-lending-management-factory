// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAuth, login, logout } from './auth';
import { authStore } from './auth-store';
import { writeLastActivity } from './idle-storage';
import { markSignOutPending } from './pending-sign-out';
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

describe('a sign-in while an idle sign-out is still on its way (Q136)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('waits for it: the sign-out clears the refresh cookie, and must not clear the new one', async () => {
    const user = {
      id: 1,
      username: 'admin',
      displayName: 'Admin',
      role: 'ADMIN' as const,
      mustChangePassword: false,
      permissions: [],
      version: 1,
    };
    // The browser is opened again long after the last activity: the old session is ended, not restored.
    writeLastActivity(Date.now() - 60 * 60_000);
    let answerSignOut: (response: Response) => void = () => undefined;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          answerSignOut = resolve;
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'token-1',
            accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
            user,
          }),
          { status: 200 },
        ),
      );

    await bootstrapAuth();
    expect(authStore.getSnapshot().status).toBe('anonymous');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/auth/logout');

    const signingIn = login({ username: 'admin', password: 'a-long-password' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answerSignOut(new Response(null, { status: 204 }));
    await expect(signingIn).resolves.toMatchObject({ username: 'admin' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/auth/login');
    authStore.clear();
  });
});

describe('one sign-out on its way at a time (Q80, Q136)', () => {
  afterEach(() => {
    localStorage.clear();
    authStore.clear();
  });

  const user = {
    id: 1,
    username: 'admin',
    displayName: 'Admin',
    role: 'ADMIN' as const,
    mustChangePassword: false,
    permissions: [],
    version: 1,
  };

  it('a page load does not send the sign-out again while the idle one is still out', async () => {
    writeLastActivity(Date.now() - 60 * 60_000);
    let answer: (response: Response) => void = () => undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    );

    // As React's development double effect makes them: two at once…
    await Promise.all([bootstrapAuth(), bootstrapAuth()]);
    // …and one later, with the first sign-out still unanswered.
    await bootstrapAuth();

    expect(authStore.getSnapshot().status).toBe('anonymous');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([expect.stringContaining('/auth/logout')]);
    answer(new Response(null, { status: 204 }));
    // Settled before the next test, which must find no sign-out on its way.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('a sign-in waits for the retry of a sign-out the server missed', async () => {
    markSignOutPending();
    let answerSignOut: (response: Response) => void = () => undefined;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          answerSignOut = resolve;
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'token-1',
            accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
            user,
          }),
          { status: 200 },
        ),
      );

    await bootstrapAuth();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/auth/logout');
    const signingIn = login({ username: 'admin', password: 'a-long-password' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answerSignOut(new Response(null, { status: 204 }));
    await expect(signingIn).resolves.toMatchObject({ username: 'admin' });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/auth/login');
  });
});
