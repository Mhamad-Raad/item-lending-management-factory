import { afterEach, describe, expect, it } from 'vitest';
import { authStore } from './auth-store';
import { clearCacheOnSignOut, createQueryClient } from './query-client';

const SESSION = {
  accessToken: 'token',
  accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: {
    id: 1,
    username: 'admin',
    displayName: 'Admin',
    role: 'ADMIN' as const,
    mustChangePassword: false,
    permissions: [],
  },
};

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  authStore.clear();
});

describe('clearCacheOnSignOut', () => {
  it('drops every cached response when the session ends', () => {
    const client = createQueryClient();
    stop = clearCacheOnSignOut(client);
    authStore.setSession(SESSION);
    client.setQueryData(['audit', 'list', {}], { items: ['a row only the admin may see'] });

    // A shared factory PC: the admin signs out and the next person signs in in the same tab.
    authStore.clear();

    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('keeps the cache while the same session carries on', () => {
    const client = createQueryClient();
    stop = clearCacheOnSignOut(client);
    authStore.setSession(SESSION);
    client.setQueryData(['users', 'list', {}], { items: [] });

    authStore.setUser({ ...SESSION.user, displayName: 'Administrator' });

    expect(client.getQueryCache().getAll()).toHaveLength(1);
  });
});
