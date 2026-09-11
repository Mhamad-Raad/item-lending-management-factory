import type { AuditAction, AuditEntityType, AuditLogDto } from '@pallet/shared';
import type { AuditLog, User } from '../../generated/prisma/client';
import { redactAuditSnapshot } from './audit-redaction';

type AuditLogRow = AuditLog & { user: Pick<User, 'id' | 'username' | 'displayName'> | null };

/**
 * Builds the response row for one audit entry, stripping cost from `before`/`after` for a viewer
 * who may not see it (§11.5). `summaryParams` never carry cost, so they pass through untouched.
 */
export function toAuditLogDto(row: AuditLogRow, canViewCost: boolean): AuditLogDto {
  const entityType = row.entityType as AuditEntityType;

  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    user: row.user ? { id: row.user.id, username: row.user.username, displayName: row.user.displayName } : null,
    usernameAttempt: row.usernameAttempt,
    action: row.action as AuditAction,
    entityType,
    entityId: row.entityId,
    summaryKey: row.summaryKey,
    summaryParams: (row.summaryParams ?? {}) as Record<string, unknown>,
    ip: row.ip,
    requestId: row.requestId,
    before: redactAuditSnapshot(entityType, row.before, canViewCost),
    after: redactAuditSnapshot(entityType, row.after, canViewCost),
  };
}
