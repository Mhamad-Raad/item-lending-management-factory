import type { PermissionKey } from '@pallet/shared';
import { redirect } from '@tanstack/react-router';
import { authStore } from './auth-store';

/** Thrown by a guard, rendered by the root route as the forbidden page (§7.2). */
export class ForbiddenError extends Error {
  constructor() {
    super('FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

/** The signed-in user; an anonymous visitor goes to the login page with the address they wanted. */
function signedInUser() {
  const { status, user } = authStore.getSnapshot();
  if (status !== 'authenticated' || !user) {
    throw redirect({ to: '/login', search: { redirect: window.location.pathname + window.location.search } });
  }
  return user;
}

/** Signed in; a user who still has to set a password can go nowhere else until they do. */
export function requireAuthenticated(): void {
  if (signedInUser().mustChangePassword) throw redirect({ to: '/change-password' });
}

/**
 * `/change-password` (Q159): signed in, and only while a password must be set. Anyone else goes on to the app: a
 * phone reopens on the last page, and a bookmark or home-screen shortcut keeps the address it was made on — often
 * this page, the first a new user sees. A change of one's own free will is on `/account`.
 */
export function requirePasswordChangePending(): void {
  if (!signedInUser().mustChangePassword) throw redirect({ to: '/' });
}

export function requirePermission(key: PermissionKey): void {
  requireAuthenticated();
  if (!authStore.can(key)) throw new ForbiddenError();
}

/** Passes when the user holds at least one of the keys — the `/reports` entry point (§7.2). */
export function requireAnyPermission(...keys: PermissionKey[]): void {
  requireAuthenticated();
  if (!keys.some((key) => authStore.can(key))) throw new ForbiddenError();
}

export function requireAdmin(): void {
  requireAuthenticated();
  if (authStore.getSnapshot().user?.role !== 'ADMIN') throw new ForbiddenError();
}
