import { z } from 'zod';
import { DisplayName } from './users.js';

/**
 * Login deliberately accepts any non-empty username: an invalid one must take exactly the same
 * path as an unknown one, so the response cannot distinguish them (§6.11).
 */
export const LoginBody = z.strictObject({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(1024),
});
export type LoginBody = z.infer<typeof LoginBody>;

/** Refresh and logout carry no data; the refresh token travels in the `pallet_rt` cookie. */
export const RefreshBody = z.strictObject({});
export type RefreshBody = z.infer<typeof RefreshBody>;

/**
 * Length is checked by the password policy, not here, so that a too-short password answers
 * `PASSWORD_TOO_SHORT` rather than a generic `VALIDATION_FAILED` (§10.1 S2).
 */
export const ChangePasswordBody = z.strictObject({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(1).max(1024),
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>;

/** Policy bounds, shared with the web app so it can show the rules before submitting. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * What a signed-in user may change about themselves (Q94): only the display name, validated exactly as
 * the admin's user form validates it. Username, role and active state stay with the administrators.
 */
export const MeUpdateBody = z.strictObject({
  displayName: DisplayName,
  /**
   * The name the form started from (Q105): a save is refused when the stored name is no longer it. The user
   * row's version would also refuse a save after an unrelated change, such as an admin editing permissions.
   */
  expectedDisplayName: z.string().max(100),
});
export type MeUpdateBody = z.infer<typeof MeUpdateBody>;
