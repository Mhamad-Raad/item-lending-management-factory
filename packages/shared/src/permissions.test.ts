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
});
