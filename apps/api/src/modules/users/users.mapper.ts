import type { GrantablePermissionKey, UserDto, UserListItemDto, UserRefDto } from '@pallet/shared';
import type { User, UserPermission } from '../../generated/prisma/client';

type UserRow = User & { permissions?: Pick<UserPermission, 'permissionKey'>[] };

export function toUserListItemDto(user: User): UserListItemDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    version: user.version,
  };
}

/** An admin's permissions are implicit, so the stored list is empty and reported as such (§6.9). */
export function toUserDto(user: UserRow, activeSessionCount: number): UserDto {
  return {
    ...toUserListItemDto(user),
    permissions:
      user.role === 'ADMIN'
        ? []
        : (user.permissions ?? []).map((p) => p.permissionKey as GrantablePermissionKey).sort(),
    activeSessionCount,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/** The columns another record needs to name its user. */
export const USER_REF_SELECT = { select: { id: true, username: true, displayName: true } } as const;

export function toUserRef(user: Pick<User, 'id' | 'username' | 'displayName'>): UserRefDto {
  return { id: user.id, username: user.username, displayName: user.displayName };
}
