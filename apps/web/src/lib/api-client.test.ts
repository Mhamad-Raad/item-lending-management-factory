import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, buildQueryString, setSessionEndedHandler } from './api-client';
import { ApiError } from './api-error';
import { authStore } from './auth-store';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.restoreAllMocks();
  authStore.clear();
});

describe('buildQueryString', () => {
  it('omits empty values, repeats arrays and keeps booleans', () => {
    expect(
      buildQueryString({
        q: 'pallet',
        page: 2,
        archived: false,
        entityType: ['USER', 'ORDER'],
        skip: undefined,
        none: null,
      }),
    ).toBe('?q=pallet&page=2&archived=false&entityType=USER&entityType=ORDER');
  });

  it('is empty when there is nothing to send', () => {
    expect(buildQueryString(undefined)).toBe('');
    expect(buildQueryString({ q: undefined })).toBe('');
  });
});

describe('apiFetch', () => {
  it('sends the CSRF header on a write and the token when there is one', async () => {
    authStore.setSession({
      accessToken: 'token-1',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: {
        id: 1,
        username: 'admin',
        displayName: 'Admin',
        role: 'ADMIN',
        mustChangePassword: false,
        permissions: [],
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { ok: true }));

    await apiFetch('/users', { method: 'POST', body: { username: 'a' } });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Requested-With']).toBe('pallet-web');
    expect(headers.Authorization).toBe('Bearer token-1');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('omits the CSRF header on a read', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/users');

    const headers = ((fetchMock.mock.calls[0]?.[1] as RequestInit).headers ?? {}) as Record<string, string>;
    expect(headers['X-Requested-With']).toBeUndefined();
  });

  it('resolves undefined for 204', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('turns an error body into an ApiError carrying its code and request id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(409, { error: { code: 'USERNAME_TAKEN' }, requestId: 'req-7' }),
    );

    await expect(apiFetch('/users', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'USERNAME_TAKEN',
      status: 409,
      requestId: 'req-7',
    });
  });

  it('reports an unreachable server as NETWORK_ERROR', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed to fetch'));

    await expect(apiFetch('/users')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('gives up on a server that never answers with REQUEST_TIMEOUT (Q88)', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        (_, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const pending = apiFetch('/users');
      const settled = expect(pending).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', status: 0 });
      await vi.advanceTimersByTimeAsync(30_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('still lets a caller cancel its own request without an error code', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = apiFetch('/users', { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('refreshes once on an expired token and retries the request exactly once', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // The original request, refused because the access token expired.
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'AUTH_TOKEN_EXPIRED' }, requestId: 'r1' }))
      // The refresh.
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: 'token-2',
          accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          user: {
            id: 1,
            username: 'admin',
            displayName: 'Admin',
            role: 'ADMIN',
            mustChangePassword: false,
            permissions: [],
          },
        }),
      )
      // The retry.
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));

    await expect(apiFetch('/users')).resolves.toEqual({ items: [] });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/users', '/api/auth/refresh', '/api/users']);
    expect(authStore.token).toBe('token-2');
  });

  it('ends the session when a fresh token is still refused', async () => {
    const sessionEnded = vi.fn();
    setSessionEndedHandler(sessionEnded);
    authStore.setSession({
      accessToken: 'token-1',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: {
        id: 1,
        username: 'admin',
        displayName: 'Admin',
        role: 'ADMIN',
        mustChangePassword: false,
        permissions: [],
      },
    });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'AUTH_TOKEN_INVALID' } }))
      // The refresh is refused too: the family was revoked while the tab was idle.
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'AUTH_REFRESH_INVALID' } }));

    await expect(apiFetch('/users')).rejects.toMatchObject({ code: 'AUTH_TOKEN_INVALID' });

    // Without this the shell would keep rendering as if signed in, every request failing.
    expect(authStore.getSnapshot().status).toBe('anonymous');
    expect(sessionEnded).toHaveBeenCalledTimes(1);
    setSessionEndedHandler(() => undefined);
  });

  describe('a refresh that could not reach the server keeps the session (Q79)', () => {
    const signedIn = (): void =>
      authStore.setSession({
        accessToken: 'token-1',
        accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        user: {
          id: 1,
          username: 'admin',
          displayName: 'Admin',
          role: 'ADMIN',
          mustChangePassword: false,
          permissions: [],
        },
      });

    it.each([
      ['offline', () => Promise.reject(new TypeError('failed to fetch')), 'NETWORK_ERROR'],
      [
        'a proxy 502 without our body',
        () => Promise.resolve(new Response('Bad Gateway', { status: 502 })),
        'SERVICE_UNAVAILABLE',
      ],
      [
        'a 503',
        () => Promise.resolve(jsonResponse(503, { error: { code: 'SERVICE_UNAVAILABLE' } })),
        'SERVICE_UNAVAILABLE',
      ],
      [
        'a rate limit',
        () =>
          Promise.resolve(jsonResponse(429, { error: { code: 'RATE_LIMITED', details: { retryAfterSeconds: 5 } } })),
        'RATE_LIMITED',
      ],
    ] as const)('%s surfaces as its own error, not a sign-out', async (_, refresh, code) => {
      const sessionEnded = vi.fn();
      setSessionEndedHandler(sessionEnded);
      signedIn();
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'AUTH_TOKEN_EXPIRED' } }))
        .mockImplementationOnce(refresh);

      await expect(apiFetch('/users')).rejects.toMatchObject({ code });

      expect(authStore.getSnapshot().status).toBe('authenticated');
      expect(authStore.token).toBe('token-1');
      expect(sessionEnded).not.toHaveBeenCalled();
      setSessionEndedHandler(() => undefined);
    });
  });

  it('reads a proxy error page on an ordinary request as SERVICE_UNAVAILABLE', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    await expect(apiFetch('/users')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 502 });
  });

  it('gives up after one retry rather than looping', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'AUTH_TOKEN_EXPIRED' } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: 'token-2',
          accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          user: {
            id: 1,
            username: 'admin',
            displayName: 'Admin',
            role: 'ADMIN',
            mustChangePassword: false,
            permissions: [],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'AUTH_TOKEN_INVALID' } }));

    await expect(apiFetch('/users')).rejects.toBeInstanceOf(ApiError);
  });

  it('never refreshes for the auth endpoints themselves', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(401, { error: { code: 'AUTH_INVALID_CREDENTIALS' } }));

    await expect(apiFetch('/auth/login', { method: 'POST', body: {}, skipAuthRetry: true })).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh for a 403, which a new token would not fix', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(403, { error: { code: 'PERMISSION_DENIED' } }));

    await expect(apiFetch('/audit-logs')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
