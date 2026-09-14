import { describe, expect, it } from 'vitest';
import {
  ADMIN_ONLY_PERMISSION_KEYS,
  GRANTABLE_PERMISSION_KEYS,
  PERMISSION_DEPENDENCIES,
  closePermissionSet,
  missingPermissionDependencies,
} from './permissions.js';

describe('permission keys', () => {
  it('are unique and follow <module>.<action>', () => {
    const all = [...GRANTABLE_PERMISSION_KEYS, ...ADMIN_ONLY_PERMISSION_KEYS];
    expect(new Set(all).size).toBe(all.length);
    for (const key of all) expect(key).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
  });

  it('dependency table only references grantable keys', () => {
    const grantable = new Set<string>(GRANTABLE_PERMISSION_KEYS);
    for (const deps of Object.values(PERMISSION_DEPENDENCIES)) {
      for (const dep of deps) expect(grantable.has(dep)).toBe(true);
    }
  });

  it('computes the transitive closure', () => {
    expect([...closePermissionSet(['orders.editUnitDeposit'])].sort()).toEqual(
      ['customers.view', 'drivers.view', 'items.view', 'orders.edit', 'orders.editUnitDeposit', 'orders.view'].sort(),
    );
    expect(missingPermissionDependencies(['reports.viewPurchases'])).toEqual(['items.view', 'items.viewCost']);
    expect(missingPermissionDependencies(['items.view', 'items.edit'])).toEqual([]);
  });

  it('U6: the cases of §14.2', () => {
    expect([...closePermissionSet(['reports.viewPurchases'])].sort()).toEqual(
      ['items.view', 'items.viewCost', 'reports.viewPurchases'].sort(),
    );
    expect(missingPermissionDependencies(['orders.create'])).toEqual([
      'customers.view',
      'drivers.view',
      'items.view',
      'orders.view',
    ]);
    const grantable = new Set<string>(GRANTABLE_PERMISSION_KEYS);
    for (const key of Object.keys(PERMISSION_DEPENDENCIES)) expect(grantable.has(key), key).toBe(true);
    for (const key of ADMIN_ONLY_PERMISSION_KEYS) expect(grantable.has(key), key).toBe(false);
  });
});
