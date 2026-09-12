import { describe, expect, it, vi } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import type { Prisma } from '../../generated/prisma/client';
import { SNAPSHOT_SPECS } from './audit-snapshot';
import { AuditService } from './audit.service';

function fakeTx(): { tx: Prisma.TransactionClient; created: () => Record<string, unknown> } {
  const create = vi.fn().mockResolvedValue(undefined);
  return {
    tx: { auditLog: { create } } as unknown as Prisma.TransactionClient,
    created: () => (create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data,
  };
}

describe('the credential scrub and the snapshot allow-lists agree', () => {
  it('keeps every field that toAuditSnapshot is allowed to write', async () => {
    // Deduplicated: several entities share field names such as `id` and `createdAt`.
    const fields = [...new Set(Object.values(SNAPSHOT_SPECS).flatMap((spec) => spec.fields))];
    const row = Object.fromEntries(fields.map((field) => [field, 'value']));
    const { tx, created } = fakeTx();

    await new AuditService().record(tx, { action: 'CREATE', entityType: 'USER', entityId: '1', after: row });

    // A field allow-listed for a snapshot but deleted by the scrub would vanish from the audit
    // trail in production with no error: add it to SENSITIVE_KEY_EXCEPTIONS or rename it.
    expect(Object.keys(created().after as Record<string, unknown>).sort()).toEqual([...fields].sort());
  });
});

describe('AuditService.record', () => {
  it('derives the summary key from the entity type and action', async () => {
    const { tx, created } = fakeTx();

    await new AuditService().record(tx, { action: 'CREATE', entityType: 'USER', entityId: '7' });

    expect(created().summaryKey).toBe('audit.summary.USER.CREATE');
  });

  it('takes ip, requestId and userId from the request context', async () => {
    const { tx, created } = fakeTx();

    await RequestContext.run({ requestId: 'req-1', ip: '10.0.0.9', userId: 3 }, () =>
      new AuditService().record(tx, { action: 'UPDATE', entityType: 'USER', entityId: '7' }),
    );

    expect(created()).toMatchObject({ ip: '10.0.0.9', requestId: 'req-1', userId: 3 });
  });

  it('writes null context fields outside a request, and an explicit userId wins', async () => {
    const { tx, created } = fakeTx();

    await new AuditService().record(tx, {
      action: 'LOGIN_FAILURE',
      entityType: 'USER',
      entityId: null,
      userId: null,
      usernameAttempt: '  ADMIN  ',
    });

    expect(created()).toMatchObject({ ip: null, requestId: null, userId: null, usernameAttempt: 'admin' });
  });

  it('strips password, token and secret keys recursively before insert', async () => {
    const { tx, created } = fakeTx();

    await new AuditService().record(tx, {
      action: 'UPDATE',
      entityType: 'USER',
      entityId: '7',
      summaryParams: { username: 'admin', newPassword: 'hunter2000' },
      before: { id: 7, passwordHash: 'x', tokenVersion: 2, nested: [{ refreshToken: 'y', keep: 1 }] },
      after: { id: 7, apiSecret: 'z', keep: 2 },
    });

    const data = created();
    expect(data.summaryParams).toEqual({ username: 'admin' });
    expect(data.before).toEqual({ id: 7, nested: [{ keep: 1 }] });
    expect(data.after).toEqual({ id: 7, keep: 2 });
    expect(JSON.stringify(data)).not.toMatch(/hunter2000|passwordHash|refreshToken|apiSecret/);
  });

  it('keeps mustChangePassword, which matches the pattern but is not a credential', async () => {
    const { tx, created } = fakeTx();

    await new AuditService().record(tx, {
      action: 'CREATE',
      entityType: 'USER',
      entityId: '7',
      after: { id: 7, mustChangePassword: true, passwordHash: 'x', tokenVersion: 1 },
    });

    expect(created().after).toEqual({ id: 7, mustChangePassword: true });
  });

  it('omits before and after when the caller passes none', async () => {
    const { tx, created } = fakeTx();

    await new AuditService().record(tx, { action: 'LOGOUT', entityType: 'SESSION', entityId: 'family-uuid' });

    const data = created();
    expect(data.before).toBeUndefined();
    expect(data.after).toBeUndefined();
    expect(data.summaryParams).toEqual({});
  });
});
