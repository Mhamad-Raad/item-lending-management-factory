/**
 * `pnpm --filter @pallet/api reconcile` / `node dist/scripts/reconcile.js`
 * Read-only consistency check of all maintained totals against the ledgers.
 * Exit code 0 = consistent, 1 = discrepancies printed as JSON lines.
 */
import { createPrismaClient } from '../prisma/create-client';
import { findLedgerDiscrepancies } from '../prisma/reconciliation';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Missing DATABASE_URL');
  const prisma = createPrismaClient(url);
  try {
    const discrepancies = await findLedgerDiscrepancies(prisma);
    for (const d of discrepancies) console.log(JSON.stringify(d));
    console.log(`[reconcile] ${discrepancies.length} discrepancies`);
    process.exitCode = discrepancies.length === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('[reconcile] failed:', err instanceof Error ? err.message : err);
  process.exit(2);
});
