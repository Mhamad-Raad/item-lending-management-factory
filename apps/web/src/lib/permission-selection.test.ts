import { describe, expect, it } from 'vitest';
import { togglePermission } from './permission-selection';

describe('togglePermission', () => {
  it('ticks what the chosen permission needs', () => {
    expect(togglePermission([], 'orders.create', true)).toEqual([
      'items.view',
      'customers.view',
      'drivers.view',
      'orders.view',
      'orders.create',
    ]);
  });

  it('ticks the cost permission behind the purchases report', () => {
    expect(togglePermission([], 'reports.viewPurchases', true)).toEqual([
      'items.view',
      'items.viewCost',
      'reports.viewPurchases',
    ]);
  });

  it('unticks everything that needed the permission being removed', () => {
    const granted = togglePermission(togglePermission([], 'orders.create', true), 'returns.create', true);

    // Removing the right to see orders removes creating orders and recording returns with it.
    expect(togglePermission(granted, 'orders.view', false)).toEqual(['items.view', 'customers.view', 'drivers.view']);
  });

  it('leaves unrelated permissions alone', () => {
    const granted = togglePermission(togglePermission([], 'orders.create', true), 'audit.view', true);

    expect(togglePermission(granted, 'orders.create', false)).toEqual([
      'items.view',
      'customers.view',
      'drivers.view',
      'orders.view',
      'audit.view',
    ]);
  });

  it('returns the keys in their canonical order, whatever order they were ticked in', () => {
    const a = togglePermission(togglePermission([], 'audit.view', true), 'items.view', true);
    const b = togglePermission(togglePermission([], 'items.view', true), 'audit.view', true);

    expect(a).toEqual(b);
  });
});
