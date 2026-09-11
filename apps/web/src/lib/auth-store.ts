import type { MeDto, PermissionKey } from '@pallet/shared';

export type AuthStatus = 'booting' | 'authenticated' | 'anonymous';

interface AuthState {
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  user: MeDto | null;
  status: AuthStatus;
}

/**
 * The access token lives here and nowhere else — never in `localStorage`, `sessionStorage`,
 * IndexedDB or a cookie (§10.1 S7), so a cross-site script cannot read it back out of storage.
 */
let state: AuthState = { accessToken: null, accessTokenExpiresAt: null, user: null, status: 'booting' };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const authStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot(): AuthState {
    return state;
  },

  setSession(session: { accessToken: string; accessTokenExpiresAt: string; user: MeDto }): void {
    state = {
      accessToken: session.accessToken,
      accessTokenExpiresAt: Date.parse(session.accessTokenExpiresAt),
      user: session.user,
      status: 'authenticated',
    };
    emit();
  },

  setUser(user: MeDto): void {
    state = { ...state, user };
    emit();
  },

  clear(): void {
    state = { accessToken: null, accessTokenExpiresAt: null, user: null, status: 'anonymous' };
    emit();
  },

  get token(): string | null {
    return state.accessToken;
  },

  /** Admins hold every key implicitly, exactly as the API decides it (§3.3). */
  can(key: PermissionKey): boolean {
    const { user } = state;
    if (!user) return false;
    return user.role === 'ADMIN' || user.permissions.includes(key);
  },
} as const;
