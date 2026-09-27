// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAuth } from './auth';
import { authStore } from './auth-store';

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

  it('signs out when the server refuses the refresh cookie', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'AUTH_REFRESH_INVALID' } }), { status: 401 }),
    );

    await expect(bootstrapAuth()).resolves.toBeUndefined();
    expect(authStore.getSnapshot().status).toBe('anonymous');
  });
});
