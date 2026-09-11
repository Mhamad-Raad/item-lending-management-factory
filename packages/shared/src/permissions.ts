/**
 * Definitive permission keys. Pattern: `<module>.<action>`.
 * Admins hold every key implicitly (GRANTABLE + ADMIN_ONLY). Employees hold only what is stored
 * in `user_permissions`, which may contain GRANTABLE keys only.
 */
export const GRANTABLE_PERMISSION_KEYS = [
  'items.view',
  'items.create',
  'items.edit',
  'items.delete',
  'items.viewCost',
  'items.adjustStock',
  'purchases.view',
  'purchases.create',
  'purchases.edit',
  'purchases.delete',
  'customers.view',
  'customers.create',
  'customers.edit',
  'customers.delete',
  'drivers.view',
  'drivers.create',
  'drivers.edit',
  'drivers.delete',
  'orders.view',
  'orders.create',
  'orders.edit',
  'orders.cancel',
  'orders.editUnitDeposit',
  'returns.create',
  'returns.edit',
  'returns.delete',
  'payments.create',
  'payments.delete',
  'reports.viewPositions',
  'reports.viewPurchases',
  'reports.viewActivity',
  'reports.viewStock',
  'audit.view',
] as const;

/** Never grantable to employees; checked by role (`ADMIN`), not by the stored permission set. */
export const ADMIN_ONLY_PERMISSION_KEYS = ['users.manage', 'settings.edit', 'orders.overrideCreditLimit'] as const;

export const PERMISSION_KEYS = [...GRANTABLE_PERMISSION_KEYS, ...ADMIN_ONLY_PERMISSION_KEYS] as const;

export type GrantablePermissionKey = (typeof GRANTABLE_PERMISSION_KEYS)[number];
export type AdminOnlyPermissionKey = (typeof ADMIN_ONLY_PERMISSION_KEYS)[number];
export type PermissionKey = GrantablePermissionKey | AdminOnlyPermissionKey;

/**
 * Implication table: holding the key on the left requires holding every key on the right.
 * A stored employee permission set must be closed under this table
 * (the API rejects an unclosed set with PERMISSION_DEPENDENCY_MISSING; the UI auto-ticks).
 */
export const PERMISSION_DEPENDENCIES: Readonly<Record<GrantablePermissionKey, readonly GrantablePermissionKey[]>> = {
  'items.view': [],
  'items.create': ['items.view'],
  'items.edit': ['items.view'],
  'items.delete': ['items.view'],
  'items.viewCost': ['items.view'],
  'items.adjustStock': ['items.view'],
  'purchases.view': ['items.view'],
  'purchases.create': ['purchases.view'],
  'purchases.edit': ['purchases.view'],
  'purchases.delete': ['purchases.view'],
  'customers.view': [],
  'customers.create': ['customers.view'],
  'customers.edit': ['customers.view'],
  'customers.delete': ['customers.view'],
  'drivers.view': [],
  'drivers.create': ['drivers.view'],
  'drivers.edit': ['drivers.view'],
  'drivers.delete': ['drivers.view'],
  'orders.view': ['customers.view', 'drivers.view', 'items.view'],
  'orders.create': ['orders.view'],
  'orders.edit': ['orders.view'],
  'orders.cancel': ['orders.view'],
  'orders.editUnitDeposit': ['orders.edit'],
  'returns.create': ['orders.view'],
  'returns.edit': ['returns.create'],
  'returns.delete': ['orders.view'],
  'payments.create': ['orders.view'],
  'payments.delete': ['orders.view'],
  'reports.viewPositions': [],
  'reports.viewPurchases': ['items.viewCost'],
  'reports.viewActivity': [],
  'reports.viewStock': [],
  'audit.view': [],
};

const GRANTABLE_SET: ReadonlySet<string> = new Set(GRANTABLE_PERMISSION_KEYS);
const ADMIN_ONLY_SET: ReadonlySet<string> = new Set(ADMIN_ONLY_PERMISSION_KEYS);

export function isGrantablePermissionKey(key: string): key is GrantablePermissionKey {
  return GRANTABLE_SET.has(key);
}

export function isAdminOnlyPermissionKey(key: string): key is AdminOnlyPermissionKey {
  return ADMIN_ONLY_SET.has(key);
}

/** Transitive closure of a permission set under PERMISSION_DEPENDENCIES. */
export function closePermissionSet(keys: Iterable<GrantablePermissionKey>): Set<GrantablePermissionKey> {
  const result = new Set<GrantablePermissionKey>();
  const stack = [...keys];
  while (stack.length > 0) {
    const key = stack.pop() as GrantablePermissionKey;
    if (result.has(key)) continue;
    result.add(key);
    stack.push(...PERMISSION_DEPENDENCIES[key]);
  }
  return result;
}

/** Keys required by `keys` but missing from it (empty array = the set is closed). */
export function missingPermissionDependencies(keys: readonly GrantablePermissionKey[]): GrantablePermissionKey[] {
  const held = new Set(keys);
  return [...closePermissionSet(keys)].filter((k) => !held.has(k)).sort();
}
