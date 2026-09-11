import { z } from 'zod';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, ROLES } from '../enums.js';
import { IdParam, PageQuery, SearchQuery, dateRange, sortParam } from './common.js';

/** Usernames are lower-cased on the way in; the pattern is what `POST /api/users` enforces. */
export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/);

export const DisplayName = z.string().trim().min(1).max(100);

/** Validated against PERMISSION_KEYS by the service, which reports the unknown keys it found. */
const PermissionKeyList = z.array(z.string().max(64)).max(64);

export const UserListQuery = z.strictObject({
  ...PageQuery,
  q: SearchQuery,
  role: z.enum(ROLES).optional(),
  isActive: z.enum(['true', 'false', 'all']).default('all'),
  sort: sortParam(['username', 'displayName', 'createdAt', 'lastLoginAt'], 'username'),
});
export type UserListQuery = z.infer<typeof UserListQuery>;

export const UserCreateBody = z.strictObject({
  username: Username,
  displayName: DisplayName,
  role: z.enum(ROLES),
  /** The policy (length, common list) is checked by the service so it can name the failing rule. */
  password: z.string().min(1).max(1024),
  permissions: PermissionKeyList.default([]),
});
export type UserCreateBody = z.infer<typeof UserCreateBody>;

export const UserUpdateBody = z
  .strictObject({
    version: z.number().int().positive(),
    displayName: DisplayName.optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => body.displayName !== undefined || body.role !== undefined || body.isActive !== undefined, {
    error: 'required',
    path: [],
    params: { code: 'required' },
  });
export type UserUpdateBody = z.infer<typeof UserUpdateBody>;

export const UserPermissionsBody = z.strictObject({
  version: z.number().int().positive(),
  permissions: PermissionKeyList,
});
export type UserPermissionsBody = z.infer<typeof UserPermissionsBody>;

export const UserResetPasswordBody = z.strictObject({ newPassword: z.string().min(1).max(1024) });
export type UserResetPasswordBody = z.infer<typeof UserResetPasswordBody>;

export const AuditLogListQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  userId: IdParam.optional(),
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entityId: z.string().max(64).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  ...dateRange,
});
export type AuditLogListQuery = z.infer<typeof AuditLogListQuery>;
