import { expect } from 'vitest';
import { createPrismaClient } from '../../src/prisma/create-client';
import { findLedgerDiscrepancies } from '../../src/prisma/reconciliation';

let skipReason: string | null = null;

/**
 * Opts the current file out of the end-of-file reconciliation. Only for files that write rows
 * around the services on purpose — to break an invariant, or to build orders without stock — and
 * the reason says which.
 */
export function skipReconciliation(reason: string): void {
  skipReason = reason;
}

/** §4.9: the test database reconciles to 0 discrepancies; run after every integration test. */
export async function expectReconciled(): Promise<void> {
  if (skipReason) return;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to reconcile the test database');
  const client = createPrismaClient(url);
  try {
    const found = await findLedgerDiscrepancies(client);
    expect(found, 'the database no longer reconciles (§4.9)').toEqual([]);
  } finally {
    await client.$disconnect();
  }
}
