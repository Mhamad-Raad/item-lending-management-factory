import type { AuditEntityType } from '@pallet/shared';
import { dbDateToBusiness } from '@pallet/shared';
import { toSafeMoney } from '../../common/utils/money';

interface SnapshotSpec {
  /** Allow-list of row fields that may be stored (§11.4: never `...row`). */
  fields: readonly string[];
  /** Fields of `@db.Date` type, rendered as `YYYY-MM-DD` rather than an ISO timestamp. */
  businessDates?: readonly string[];
}

/**
 * One entry per entity type whose rows are snapshotted; added by the milestone that
 * introduces the entity. An entity with no entry throws rather than falling back to the
 * whole row, so a new table cannot leak fields into the audit log by accident.
 */
export const SNAPSHOT_SPECS: Partial<Record<AuditEntityType, SnapshotSpec>> = {
  USER: { fields: ['id', 'username', 'displayName', 'role', 'isActive', 'mustChangePassword', 'createdAt'] },
  UPLOAD: { fields: ['id', 'fileName', 'kind', 'width', 'height', 'sizeBytes', 'createdAt'] },
  SETTINGS: { fields: ['factoryName', 'phone', 'address', 'logoUploadId', 'version'] },
  ITEM: {
    fields: [
      'id',
      'name',
      'depositPrice',
      'minStock',
      'imageUploadId',
      'quantityOnHand',
      'archivedAt',
      'version',
      'createdAt',
    ],
  },
  PURCHASE_BATCH: {
    fields: ['id', 'itemId', 'itemName', 'date', 'quantity', 'unitCost', 'totalCost', 'note', 'deletedAt', 'version'],
    businessDates: ['date'],
  },
  CUSTOMER: {
    fields: ['id', 'name', 'phone', 'altPhone', 'address', 'creditLimit', 'archivedAt', 'version', 'createdAt'],
  },
  DRIVER: { fields: ['id', 'name', 'phone', 'carNumber', 'archivedAt', 'version', 'createdAt'] },
};

function normalise(value: unknown, isBusinessDate: boolean): unknown {
  if (typeof value === 'bigint') return toSafeMoney(value);
  if (value instanceof Date) return isBusinessDate ? dbDateToBusiness(value) : value.toISOString();
  return value;
}

/**
 * Builds the `before` / `after` snapshot of a row for the audit log: camelCase keys, money and
 * quantities as JSON numbers, business dates as `YYYY-MM-DD`, timestamps as ISO UTC strings.
 */
export function toAuditSnapshot(entityType: AuditEntityType, row: Record<string, unknown>): Record<string, unknown> {
  const spec = SNAPSHOT_SPECS[entityType];
  if (!spec) throw new Error(`No audit snapshot allow-list for entity type ${entityType}`);

  const snapshot: Record<string, unknown> = {};
  for (const field of spec.fields) {
    if (!(field in row)) continue;
    snapshot[field] = normalise(row[field], spec.businessDates?.includes(field) ?? false);
  }
  return snapshot;
}

/** The named fields of a snapshot, for the rows that record only what changed (§6.13, §6.15). */
export function pickSnapshot(snapshot: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, snapshot[field]]));
}
