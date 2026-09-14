import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  LEDGER_ENTRY_SOURCES,
  LEDGER_ENTRY_TYPES,
  ORDER_STATUSES,
  PAYMENT_TYPES,
  RETURN_REVERSAL_KINDS,
  ROLES,
  STOCK_MOVEMENT_REASONS,
  UPLOAD_KINDS,
} from './enums.js';

const SCHEMA = fileURLToPath(new URL('../../../apps/api/prisma/schema.prisma', import.meta.url));

/** Each `enum Name { ... }` block of the Prisma schema, by name, with its values in order. */
function prismaEnums(): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  for (const [, name = '', body = ''] of readFileSync(SCHEMA, 'utf8').matchAll(/^enum (\w+) \{([^}]*)\}/gm)) {
    const values = body
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter((line) => line !== '' && !line.startsWith('@@'));
    enums.set(name, values);
  }
  return enums;
}

/** U7 (§14.2): the database enums and the shared arrays are the same lists, in the same order. */
describe('U7: enum parity with the Prisma schema', () => {
  const enums = prismaEnums();
  const shared: [string, readonly string[]][] = [
    ['Role', ROLES],
    ['PaymentType', PAYMENT_TYPES],
    ['OrderStatus', ORDER_STATUSES],
    ['StockMovementReason', STOCK_MOVEMENT_REASONS],
    ['LedgerEntryType', LEDGER_ENTRY_TYPES],
    ['LedgerEntrySource', LEDGER_ENTRY_SOURCES],
    ['ReturnReversalKind', RETURN_REVERSAL_KINDS],
    ['UploadKind', UPLOAD_KINDS],
    ['AuditAction', AUDIT_ACTIONS],
    ['AuditEntityType', AUDIT_ENTITY_TYPES],
  ];

  it.each(shared)('%s', (name, values) => {
    expect(enums.get(name), `enum ${name} in schema.prisma`).toEqual([...values]);
  });

  it('reads every enum block, so a renamed enum cannot slip past', () => {
    expect([...enums.keys()]).toEqual(
      expect.arrayContaining([...shared.map(([name]) => name), 'RefreshTokenStatus', 'SessionRevokeReason']),
    );
  });
});
