import { describe, expect, it } from 'vitest';
import { redactAuditSnapshot } from './audit-redaction';
import { toAuditSnapshot } from './audit-snapshot';

describe('toAuditSnapshot', () => {
  it('keeps only allow-listed USER fields, never the credential columns', () => {
    const snapshot = toAuditSnapshot('USER', {
      id: 7,
      username: 'admin',
      displayName: 'Administrator',
      role: 'ADMIN',
      isActive: true,
      mustChangePassword: false,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$abc',
      tokenVersion: 3,
    });

    expect(snapshot).toEqual({
      id: 7,
      username: 'admin',
      displayName: 'Administrator',
      role: 'ADMIN',
      isActive: true,
      mustChangePassword: false,
    });
  });

  it('normalises bigint columns to numbers and timestamps to ISO strings', () => {
    const snapshot = toAuditSnapshot('USER', {
      id: 1n,
      username: 'admin',
      createdAt: new Date('2026-09-11T21:00:00Z'),
    });

    expect(snapshot).toEqual({ id: 1, username: 'admin', createdAt: '2026-09-11T21:00:00.000Z' });
  });

  it('refuses to snapshot an entity type that has no allow-list', () => {
    // Session rows carry no snapshot (§11.2): asking for one is a bug, not a reason to store the row.
    expect(() => toAuditSnapshot('SESSION', { id: 1 })).toThrow(/allow-list/);
  });
});

describe('redactAuditSnapshot', () => {
  it('removes purchase batch cost only from a viewer who may not see cost', () => {
    const batch = { id: 4, itemId: 2, quantity: 100, unitCost: 750, totalCost: 75_000 };

    expect(redactAuditSnapshot('PURCHASE_BATCH', batch, false)).toEqual({ id: 4, itemId: 2, quantity: 100 });
    expect(redactAuditSnapshot('PURCHASE_BATCH', batch, true)).toEqual(batch);
  });

  it('removes nested item cost without touching the rest of the snapshot', () => {
    const item = { id: 9, name: 'Euro pallet', initialBatch: { quantity: 50, unitCost: 700, totalCost: 35_000 } };

    expect(redactAuditSnapshot('ITEM', item, false)).toEqual({
      id: 9,
      name: 'Euro pallet',
      initialBatch: { quantity: 50 },
    });
  });

  it('redacts every element when a path crosses a collection', () => {
    const item = {
      id: 9,
      initialBatch: [
        { quantity: 50, unitCost: 700, totalCost: 35_000 },
        { quantity: 20, unitCost: 800, totalCost: 16_000 },
      ],
    };

    expect(redactAuditSnapshot('ITEM', item, false)).toEqual({
      id: 9,
      initialBatch: [{ quantity: 50 }, { quantity: 20 }],
    });
  });

  it('leaves entity types that carry no cost untouched', () => {
    const user = { id: 1, username: 'admin' };

    expect(redactAuditSnapshot('USER', user, false)).toBe(user);
  });

  it('does not mutate the row it was given', () => {
    const batch = { id: 4, unitCost: 750, totalCost: 75_000 };
    redactAuditSnapshot('PURCHASE_BATCH', batch, false);

    expect(batch.unitCost).toBe(750);
  });
});
