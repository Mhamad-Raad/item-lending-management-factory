import { ApiError } from '../errors/api-error';

/**
 * Optimistic concurrency (§6.5): an update names the version it was made from, and anything else is
 * refused with the version that is stored now, so the client can reload and try again.
 */
export function assertVersion(storedVersion: number, expectedVersion: number): void {
  if (storedVersion !== expectedVersion) throw new ApiError('VERSION_CONFLICT', { currentVersion: storedVersion });
}

/**
 * The fields a PATCH actually changes (Q37): named in the body and different from the stored value.
 * An empty result means the save changes nothing and must write nothing — no version bump, no history
 * row. `current` holds the stored values in the body's terms (money as numbers, dates as business dates).
 */
export function changedFields<K extends string>(
  body: { readonly [P in K]?: unknown },
  current: { readonly [P in K]: unknown },
  fields: readonly K[],
): K[] {
  return fields.filter((field) => body[field] !== undefined && body[field] !== current[field]);
}
