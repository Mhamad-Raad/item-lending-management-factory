import type { GrantablePermissionKey } from '@pallet/shared';

/**
 * Access declarations. Every route handler must carry exactly one of these; the startup
 * check (`common/checks/permission-declaration.check.ts`) enumerates the routes and fails
 * the process when a handler has none or more than one.
 */
export const ACCESS_METADATA = 'pallet:access';

export type AccessRule =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'adminOnly' }
  | { kind: 'all'; keys: GrantablePermissionKey[] }
  | { kind: 'any'; keys: GrantablePermissionKey[] };

/**
 * Appends rather than replaces: two declarations on one handler must stay visible to the
 * startup check instead of the lower decorator silently winning.
 */
function declareAccess(rule: AccessRule): MethodDecorator {
  return (_target, _propertyKey, descriptor) => {
    const handler = descriptor.value as object;
    const existing = (Reflect.getMetadata(ACCESS_METADATA, handler) as AccessRule[] | undefined) ?? [];
    Reflect.defineMetadata(ACCESS_METADATA, [...existing, rule], handler);
    return descriptor;
  };
}

/** Reads the declarations of one handler; empty when it carries none. */
export function getAccessRules(handler: object): AccessRule[] {
  return (Reflect.getMetadata(ACCESS_METADATA, handler) as AccessRule[] | undefined) ?? [];
}

/** No authentication (login, refresh, logout, health, uploads). */
export const Public = (): MethodDecorator => declareAccess({ kind: 'public' });

/** Any logged-in, active user. */
export const Authenticated = (): MethodDecorator => declareAccess({ kind: 'authenticated' });

/** Role ADMIN only (user management, settings, credit override). */
export const AdminOnly = (): MethodDecorator => declareAccess({ kind: 'adminOnly' });

/** At least one key: `@RequirePermission()` would gate nothing while looking like a gate. */
type PermissionKeys = [GrantablePermissionKey, ...GrantablePermissionKey[]];

/** Every listed key is required. */
export const RequirePermission = (...keys: PermissionKeys): MethodDecorator => declareAccess({ kind: 'all', keys });

/** At least one listed key is required. */
export const RequireAnyPermission = (...keys: PermissionKeys): MethodDecorator => declareAccess({ kind: 'any', keys });
