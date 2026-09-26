import { describe, expect, it } from 'vitest';
import { AUDIT_ENTITY_VIEW_PERMISSION, visibleAuditEntityTypes } from './audit-matrix.js';
import { AUDIT_ENTITY_TYPES } from './enums.js';
import { PERMISSION_KEYS, type PermissionKey } from './permissions.js';

describe('visibleAuditEntityTypes (Q73)', () => {
  it('shows an admin every kind of row', () => {
    expect(visibleAuditEntityTypes(() => true)).toEqual([...AUDIT_ENTITY_TYPES]);
  });

  it('shows a reader with no other permission only settings and uploads', () => {
    expect(visibleAuditEntityTypes(() => false)).toEqual(['SETTINGS', 'UPLOAD']);
  });

  it('follows the view permissions: orders bring returns and money, never users or sign-ins', () => {
    const held = new Set<PermissionKey>(['orders.view', 'customers.view', 'drivers.view', 'items.view']);
    expect(visibleAuditEntityTypes((key) => held.has(key))).toEqual([
      'ITEM',
      'CUSTOMER',
      'DRIVER',
      'ORDER',
      'RETURN',
      'LEDGER_ENTRY',
      'SETTINGS',
      'UPLOAD',
    ]);
  });

  it('names only real permission keys', () => {
    for (const key of Object.values(AUDIT_ENTITY_VIEW_PERMISSION)) {
      if (key !== null) expect(PERMISSION_KEYS).toContain(key);
    }
  });
});
