import { PERMISSION_KEYS, type MeDto, type PermissionKey } from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import type { Prisma, User, UserPermission } from '../../generated/prisma/client';

/** Loads what `toMeDto` and the guard read of a user's permissions: the keys, nothing else. */
export const USER_WITH_PERMISSIONS = {
  permissions: { select: { permissionKey: true } },
} as const satisfies Prisma.UserInclude;

type UserWithPermissions = User & { permissions: Pick<UserPermission, 'permissionKey'>[] };

/** Admins hold every key implicitly; employees only what is stored for them (§6.9). */
export function toMeDto(user: UserWithPermissions): MeDto {
  const permissions =
    user.role === 'ADMIN'
      ? [...PERMISSION_KEYS]
      : user.permissions.map((permission) => permission.permissionKey as PermissionKey);

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    permissions: [...permissions].sort(),
  };
}

/** The same DTO from the context AuthGuard already built, without loading the user again. */
export function contextToMeDto(auth: AuthContext): MeDto {
  return {
    id: auth.userId,
    username: auth.username,
    displayName: auth.displayName,
    role: auth.role,
    mustChangePassword: auth.mustChangePassword,
    permissions: [...auth.permissions].sort(),
  };
}
