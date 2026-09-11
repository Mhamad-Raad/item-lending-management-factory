import { Injectable } from '@nestjs/common';
import {
  PERMISSION_KEYS,
  isAdminOnlyPermissionKey,
  isGrantablePermissionKey,
  missingPermissionDependencies,
  type GrantablePermissionKey,
  type PageDto,
  type UserCreateBody,
  type UserDto,
  type UserListItemDto,
  type UserListQuery,
  type UserPermissionsBody,
  type UserResetPasswordBody,
  type UserUpdateBody,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { escapeLikePattern } from '../../common/utils/search';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import type { Prisma, User } from '../../generated/prisma/client';
import { lockActiveAdmins, lockUser } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { checkPasswordPolicy } from '../auth/password-policy';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { toUserDto, toUserListItemDto } from './users.mapper';

/** The unique constraint behind `users.username`, named for both driver error shapes. */
const USERNAME_UNIQUE = { index: 'users_username_key', columns: ['username'] } as const;

const SORT_COLUMNS = {
  username: 'username',
  displayName: 'displayName',
  createdAt: 'createdAt',
  lastLoginAt: 'lastLoginAt',
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async list(query: UserListQuery): Promise<PageDto<UserListItemDto>> {
    const where: Prisma.UserWhereInput = {
      ...(query.isActive === 'all' ? {} : { isActive: query.isActive === 'true' }),
      ...(query.role ? { role: query.role } : {}),
      ...(query.q
        ? {
            OR: [
              { username: { contains: escapeLikePattern(query.q), mode: 'insensitive' } },
              { displayName: { contains: escapeLikePattern(query.q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const descending = query.sort.startsWith('-');
    const field = (descending ? query.sort.slice(1) : query.sort) as keyof typeof SORT_COLUMNS;
    // `lastLoginAt` is null for anyone who has never signed in, and PostgreSQL sorts nulls first
    // when descending — which would head "most recent login" with the people who never logged in.
    const direction = descending ? 'desc' : 'asc';
    const order =
      SORT_COLUMNS[field] === 'lastLoginAt'
        ? { lastLoginAt: { sort: direction, nulls: 'last' } as const }
        : { [SORT_COLUMNS[field]]: direction };

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [order, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { items: rows.map(toUserListItemDto), page: query.page, pageSize: query.pageSize, total };
  }

  async get(userId: number): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { permissions: { select: { permissionKey: true } } },
    });
    if (!user) throw new ApiError('USER_NOT_FOUND', { userId });

    return toUserDto(user, await this.countActiveSessions(this.prisma, user.id));
  }

  async create(body: UserCreateBody): Promise<UserDto> {
    const policyFailure = checkPasswordPolicy(body.password, body.username);
    if (policyFailure) throw new ApiError(policyFailure);

    const permissions = this.validatePermissions(body.role, body.permissions);
    const passwordHash = await this.passwords.hash(body.password);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.user
        .create({
          data: {
            username: body.username,
            displayName: body.displayName,
            role: body.role,
            passwordHash,
            mustChangePassword: true,
            permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
          },
          include: { permissions: { select: { permissionKey: true } } },
        })
        .catch((error: unknown) => {
          if (isUniqueViolation(error, USERNAME_UNIQUE)) throw new ApiError('USERNAME_TAKEN');
          throw error;
        });

      await this.audit.record(tx, {
        action: 'CREATE',
        entityType: 'USER',
        entityId: String(created.id),
        summaryParams: { username: created.username, role: created.role },
        after: { ...toAuditSnapshot('USER', created), permissions },
      });

      return toUserDto(created, 0);
    });
  }

  /** §6.12 PATCH: the self and last-admin guards, then the role and activation side effects. */
  async update(userId: number, body: UserUpdateBody, actor: AuthContext): Promise<UserDto> {
    const touchesAdminPower = body.role !== undefined || body.isActive !== undefined;

    return this.prisma.$transaction(async (tx) => {
      if (touchesAdminPower) await lockActiveAdmins(tx);
      await lockUser(tx, userId);

      const before = await tx.user.findUnique({
        where: { id: userId },
        include: { permissions: { select: { permissionKey: true } } },
      });
      if (!before) throw new ApiError('USER_NOT_FOUND', { userId });
      if (before.version !== body.version) {
        throw new ApiError('VERSION_CONFLICT', { currentVersion: before.version });
      }

      if (userId === actor.userId && body.isActive === false) throw new ApiError('SELF_DEACTIVATE_FORBIDDEN');
      if (userId === actor.userId && body.role === 'EMPLOYEE' && before.role === 'ADMIN') {
        throw new ApiError('SELF_DEMOTE_FORBIDDEN');
      }

      const losesAdminPower =
        before.role === 'ADMIN' && before.isActive && (body.role === 'EMPLOYEE' || body.isActive === false);
      if (losesAdminPower) {
        const otherAdmins = await tx.user.count({
          where: { role: 'ADMIN', isActive: true, id: { not: userId } },
        });
        if (otherAdmins === 0) throw new ApiError('LAST_ADMIN_GUARD');
      }

      const roleChanged = body.role !== undefined && body.role !== before.role;
      const deactivating = body.isActive === false && before.isActive;

      // A role change in either direction empties the stored set: an admin holds every key
      // implicitly, and a demoted admin must not inherit one.
      if (roleChanged) await tx.userPermission.deleteMany({ where: { userId } });
      if (deactivating) await this.sessions.revokeAllFamilies(tx, userId, 'USER_DEACTIVATED');

      const after = await tx.user.update({
        where: { id: userId },
        data: {
          displayName: body.displayName,
          role: body.role,
          isActive: body.isActive,
          version: { increment: 1 },
          ...(deactivating ? { tokenVersion: { increment: 1 } } : {}),
        },
        include: { permissions: { select: { permissionKey: true } } },
      });

      await this.auditUpdate(tx, before, after, body);
      return toUserDto(after, await this.countActiveSessions(tx, userId));
    });
  }

  async setPermissions(userId: number, body: UserPermissionsBody): Promise<UserDto> {
    return this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const before = await tx.user.findUnique({
        where: { id: userId },
        include: { permissions: { select: { permissionKey: true } } },
      });
      if (!before) throw new ApiError('USER_NOT_FOUND', { userId });
      if (before.version !== body.version) {
        throw new ApiError('VERSION_CONFLICT', { currentVersion: before.version });
      }

      // Unlike creation, which may name an admin with no permissions, setting them on an admin is
      // refused outright: there is no set to hold, so the request can only be a misunderstanding.
      if (before.role === 'ADMIN') throw new ApiError('PERMISSIONS_ADMIN_IMPLICIT');

      const permissions = this.validatePermissions(before.role, body.permissions);
      const previous = before.permissions.map((p) => p.permissionKey);

      await tx.userPermission.deleteMany({ where: { userId } });
      await tx.userPermission.createMany({
        data: permissions.map((permissionKey) => ({ userId, permissionKey })),
      });
      const after = await tx.user.update({
        where: { id: userId },
        data: { version: { increment: 1 } },
        include: { permissions: { select: { permissionKey: true } } },
      });

      await this.audit.record(tx, {
        action: 'PERMISSION_CHANGE',
        entityType: 'USER',
        entityId: String(userId),
        summaryParams: {
          username: before.username,
          added: permissions.filter((key) => !previous.includes(key)).length,
          removed: previous.filter((key) => !permissions.includes(key as GrantablePermissionKey)).length,
        },
        before: { permissions: [...previous].sort() },
        after: { permissions: [...permissions].sort() },
      });

      // Sessions are untouched: the new set applies on the user's next request.
      return toUserDto(after, await this.countActiveSessions(tx, userId));
    });
  }

  async resetPassword(userId: number, body: UserResetPasswordBody): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new ApiError('USER_NOT_FOUND', { userId });

      const policyFailure = checkPasswordPolicy(body.newPassword, user.username);
      if (policyFailure) throw new ApiError(policyFailure);

      await this.sessions.revokeAllFamilies(tx, userId, 'PASSWORD_RESET');
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: await this.passwords.hash(body.newPassword),
          mustChangePassword: true,
          tokenVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        action: 'PASSWORD_RESET',
        entityType: 'USER',
        entityId: String(userId),
        summaryParams: { username: user.username },
      });
    });
  }

  async logoutAll(userId: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new ApiError('USER_NOT_FOUND', { userId });

      const families = await this.sessions.revokeAllFamilies(tx, userId, 'LOGOUT_ALL');
      await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });

      await this.audit.record(tx, {
        action: 'LOGOUT_ALL',
        entityType: 'USER',
        entityId: String(userId),
        summaryParams: { username: user.username, families },
      });
    });
  }

  /**
   * Rejects the whole set rather than silently dropping keys: an admin who mistypes a key should
   * see which one, not discover later that a permission was never granted.
   */
  private validatePermissions(role: User['role'], keys: string[]): GrantablePermissionKey[] {
    if (role === 'ADMIN') {
      if (keys.length > 0) throw new ApiError('PERMISSIONS_ADMIN_IMPLICIT');
      return [];
    }

    const unknown = keys.filter((key) => !PERMISSION_KEYS.includes(key as never));
    if (unknown.length > 0) throw new ApiError('PERMISSION_KEY_UNKNOWN', { keys: unknown });

    const adminOnly = keys.filter((key) => isAdminOnlyPermissionKey(key));
    if (adminOnly.length > 0) throw new ApiError('PERMISSION_NOT_GRANTABLE', { keys: adminOnly });

    const unique = [...new Set(keys.filter((key) => isGrantablePermissionKey(key)))] as GrantablePermissionKey[];
    const missing = missingPermissionDependencies(unique);
    if (missing.length > 0) throw new ApiError('PERMISSION_DEPENDENCY_MISSING', { missing });

    return unique.sort();
  }

  private countActiveSessions(client: Prisma.TransactionClient, userId: number): Promise<number> {
    return client.sessionFamily.count({
      where: { userId, revokedAt: null, absoluteExpiresAt: { gt: this.clock.now() } },
    });
  }

  private async auditUpdate(
    tx: Prisma.TransactionClient,
    before: User & { permissions: Pick<{ permissionKey: string }, 'permissionKey'>[] },
    after: User,
    body: UserUpdateBody,
  ): Promise<void> {
    const username = before.username;

    if (body.displayName !== undefined && body.displayName !== before.displayName) {
      await this.audit.record(tx, {
        action: 'UPDATE',
        entityType: 'USER',
        entityId: String(after.id),
        summaryParams: { username, fields: ['displayName'] },
        before: toAuditSnapshot('USER', before),
        after: toAuditSnapshot('USER', after),
      });
    }

    if (body.role !== undefined && body.role !== before.role) {
      await this.audit.record(tx, {
        action: 'PERMISSION_CHANGE',
        entityType: 'USER',
        entityId: String(after.id),
        summaryParams: { username, added: 0, removed: before.permissions.length },
        before: { role: before.role, permissions: before.permissions.map((p) => p.permissionKey).sort() },
        after: { role: after.role, permissions: [] },
      });
    }

    if (body.isActive !== undefined && body.isActive !== before.isActive) {
      await this.audit.record(tx, {
        action: body.isActive ? 'USER_ACTIVATE' : 'USER_DEACTIVATE',
        entityType: 'USER',
        entityId: String(after.id),
        summaryParams: { username },
        before: toAuditSnapshot('USER', before),
        after: toAuditSnapshot('USER', after),
      });
    }
  }
}
