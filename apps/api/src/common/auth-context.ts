import type { PermissionKey, Role } from '@pallet/shared';

/**
 * The authenticated caller, rebuilt from the database on every request so that a permission or
 * role change takes effect immediately, without re-issuing tokens (§6.4.1).
 */
export interface AuthContext {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  isAdmin: boolean;
  mustChangePassword: boolean;
  permissions: ReadonlySet<PermissionKey>;
  canViewCost: boolean;
  ip: string;
  requestId: string;
}

/** `req.auth` is set by AuthGuard. */
export interface AuthenticatedRequest {
  auth?: AuthContext;
}
