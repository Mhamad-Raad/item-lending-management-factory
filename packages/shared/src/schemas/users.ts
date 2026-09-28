import { z } from 'zod';
import { ROLES } from '../enums.js';
import { AT_LEAST_ONE_FIELD_ERROR, PageQuery, SearchQuery, hasFieldBesidesVersion, sortParam } from './common.js';

/** Usernames are lower-cased on the way in; the pattern is what `POST /api/users` enforces. */
export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/);

/**
 * Control (Cc) and format (Cf) characters a display name may not hold (Q121): bidi overrides and isolates can
 * make one name read as another, zero-width characters make two names look the same. The zero-width non-joiner
 * (U+200C) stays allowed: Sorani and Persian spelling needs it, and the uniqueness check ignores it.
 */
const INVISIBLE_CHARACTER = /(?!\u200C)[\p{Cc}\p{Cf}]/u;

/** Whether a display name is free of the invisible characters above. */
export function hasNoInvisibleCharacters(value: string): boolean {
  return !INVISIBLE_CHARACTER.test(value);
}

export const DisplayName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(hasNoInvisibleCharacters, { params: { code: 'invisible_characters' } });

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
  .refine(hasFieldBesidesVersion, AT_LEAST_ONE_FIELD_ERROR);
export type UserUpdateBody = z.infer<typeof UserUpdateBody>;

export const UserPermissionsBody = z.strictObject({
  version: z.number().int().positive(),
  permissions: PermissionKeyList,
});
export type UserPermissionsBody = z.infer<typeof UserPermissionsBody>;

export const UserResetPasswordBody = z.strictObject({ newPassword: z.string().min(1).max(1024) });
export type UserResetPasswordBody = z.infer<typeof UserResetPasswordBody>;
