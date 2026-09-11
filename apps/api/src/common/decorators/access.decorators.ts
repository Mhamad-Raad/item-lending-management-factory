import { SetMetadata } from '@nestjs/common';
import type { GrantablePermissionKey } from '@pallet/shared';

/**
 * Access declarations. Every route handler must carry exactly one of these
 * (enforced at startup by the permission-declaration check added in milestone 1).
 */
export const ACCESS_METADATA = 'pallet:access';

export type AccessRule =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'adminOnly' }
  | { kind: 'all'; keys: GrantablePermissionKey[] }
  | { kind: 'any'; keys: GrantablePermissionKey[] };

/** No authentication (login, refresh, logout, health, uploads). */
export const Public = () => SetMetadata(ACCESS_METADATA, { kind: 'public' } satisfies AccessRule);

/** Any logged-in, active user. */
export const Authenticated = () => SetMetadata(ACCESS_METADATA, { kind: 'authenticated' } satisfies AccessRule);

/** Role ADMIN only (users.manage, settings.edit, credit override). */
export const AdminOnly = () => SetMetadata(ACCESS_METADATA, { kind: 'adminOnly' } satisfies AccessRule);

/** Every listed key is required. */
export const RequirePermission = (...keys: GrantablePermissionKey[]) =>
  SetMetadata(ACCESS_METADATA, { kind: 'all', keys } satisfies AccessRule);

/** At least one listed key is required. */
export const RequireAnyPermission = (...keys: GrantablePermissionKey[]) =>
  SetMetadata(ACCESS_METADATA, { kind: 'any', keys } satisfies AccessRule);
