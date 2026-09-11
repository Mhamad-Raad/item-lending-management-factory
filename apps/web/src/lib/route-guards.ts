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

/**
 * Anonymous visitors go to the login page with the address they wanted, and a user who still has
 * to set a password can go nowhere else until they do.
 */
export function requireAuthenticated(options: { allowPasswordChange?: boolean } = {}): void {
  const { status, user } = authStore.getSnapshot();

  if (status !== 'authenticated' || !user) {
    throw redirect({ to: '/login', search: { redirect: window.location.pathname + window.location.search } });
  }
  if (user.mustChangePassword && !options.allowPasswordChange) {
    throw redirect({ to: '/change-password' });
  }
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
