import { GRANTABLE_PERMISSION_KEYS, closePermissionSet, type GrantablePermissionKey } from '@pallet/shared';

/** `items.view` → `permissions.items_view`, the key convention of §7.10. */
export function permissionLabelKey(key: string): string {
  return `permissions.${key.replace(/\./g, '_')}`;
}

/**
 * The selection a checkbox click produces. Ticking a key also ticks everything it needs; unticking
 * one also unticks everything that needed it, so the set on screen is always one the API accepts
 * (§7.3.19) and the user never has to work out the dependency graph themselves.
 */
export function togglePermission(
  selected: readonly GrantablePermissionKey[],
  key: GrantablePermissionKey,
  checked: boolean,
): GrantablePermissionKey[] {
  const next = new Set(selected);

  if (checked) {
    for (const dependency of closePermissionSet([key])) next.add(dependency);
  } else {
    next.delete(key);
    for (const candidate of [...next]) {
      if (closePermissionSet([candidate]).has(key)) next.delete(candidate);
    }
  }

  return GRANTABLE_PERMISSION_KEYS.filter((candidate) => next.has(candidate));
}
