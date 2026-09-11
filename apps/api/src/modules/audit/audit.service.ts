import { Injectable } from '@nestjs/common';
import type { AuditAction, AuditEntityType } from '@pallet/shared';
import { RequestContext } from '../../common/context/request-context';
import type { Prisma } from '../../generated/prisma/client';

export interface AuditEntry {
  action: AuditAction;
  entityType: AuditEntityType;
  /** Integer ids as decimal strings, session families as their uuid. */
  entityId: string | null;
  summaryParams?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  /** Login events only: the attempted username, stored even when no user matched it. */
  usernameAttempt?: string | null;
  /** Overrides the request context — login writes the row for the user it just authenticated. */
  userId?: number | null;
}

const SENSITIVE_KEY = /password|token|secret/i;
/**
 * Field names that match the pattern but carry no credential. Keep this list tiny and explicit:
 * everything on it is a name the safety net below would otherwise delete from a snapshot.
 */
const SENSITIVE_KEY_EXCEPTIONS = new Set(['mustChangePassword']);
const USERNAME_ATTEMPT_MAX_LENGTH = 64;

/**
 * Defence in depth behind the allow-lists of `toAuditSnapshot` (§11.4): whatever a caller
 * passes, a key that looks like a credential never reaches the database.
 */
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key) && !SENSITIVE_KEY_EXCEPTIONS.has(key)) continue;
    result[key] = scrub(nested);
  }
  return result;
}

function toJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined || value === null ? undefined : (scrub(value) as Prisma.InputJsonValue);
}

/**
 * Writes audit rows through the transaction client of the mutation they describe, so a
 * rolled-back mutation leaves no audit row behind (§11.1). `ip`, `requestId` and `userId` come
 * from the request context; callers never pass them.
 */
@Injectable()
export class AuditService {
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    const context = RequestContext.get();
    const userId = entry.userId === undefined ? (context?.userId ?? null) : entry.userId;

    await tx.auditLog.create({
      data: {
        userId,
        usernameAttempt: entry.usernameAttempt?.trim().toLowerCase().slice(0, USERNAME_ATTEMPT_MAX_LENGTH) ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        summaryKey: `audit.summary.${entry.entityType}.${entry.action}`,
        summaryParams: scrub(entry.summaryParams ?? {}) as Prisma.InputJsonValue,
        ip: context?.ip || null,
        requestId: context?.requestId || null,
        before: toJsonInput(entry.before),
        after: toJsonInput(entry.after),
      },
    });
  }
}
