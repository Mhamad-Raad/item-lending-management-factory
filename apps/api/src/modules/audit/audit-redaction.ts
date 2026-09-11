import type { AuditEntityType } from '@pallet/shared';

/**
 * Cost is stored in the audit log but stripped from `GET /api/audit-logs` for viewers who are
 * not admins and lack `items.viewCost` (§11.5). Paths are dot-separated from the snapshot root.
 */
export const AUDIT_READ_REDACTIONS: Partial<Record<AuditEntityType, readonly string[]>> = {
  PURCHASE_BATCH: ['unitCost', 'totalCost'],
  ITEM: ['initialBatch.unitCost', 'initialBatch.totalCost'],
};

function removePath(snapshot: Record<string, unknown>, path: readonly string[]): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    delete snapshot[head];
    return;
  }

  const nested = snapshot[head];
  if (!nested || typeof nested !== 'object') return;
  // Line collections (`lines.unitCost`) are the reason cost can hide one level down.
  const targets = Array.isArray(nested) ? nested : [nested];
  for (const target of targets) {
    if (target && typeof target === 'object') removePath(target as Record<string, unknown>, rest);
  }
}

/**
 * Returns the snapshot without the cost fields of its entity type, for a viewer who may not see
 * cost. The input is not mutated — audit rows are read straight from the database and the same
 * row may be rendered for several viewers.
 */
export function redactAuditSnapshot<T>(entityType: AuditEntityType, snapshot: T, canViewCost: boolean): T {
  const paths = AUDIT_READ_REDACTIONS[entityType];
  if (canViewCost || !paths || snapshot === null || typeof snapshot !== 'object') return snapshot;

  const copy = structuredClone(snapshot) as Record<string, unknown>;
  for (const path of paths) removePath(copy, path.split('.'));
  return copy as T;
}
