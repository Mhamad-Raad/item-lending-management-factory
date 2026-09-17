/**
 * `pnpm test:e2e:live` only (§14.6, Q63): empties the TEST database and puts back what the application always
 * expects — the order counter, default factory settings and one admin who can sign in straight away — so the
 * demo seed can run on it next. Refuses production and any database whose name does not end in `_test`: this
 * truncates every table, ledgers included.
 *
 * Reads `DATABASE_MIGRATE_URL` (the owner role: only it may truncate) and `ADMIN_USERNAME`, `ADMIN_DISPLAY_NAME`,
 * `ADMIN_PASSWORD`.
 */
import argon2 from 'argon2';
import { ARGON2_OPTIONS } from '../modules/auth/password.constants';
import { Prisma } from '../generated/prisma/client';
import { createPrismaClient } from '../prisma/create-client';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('e2e-reset never runs in production');
  const username = required('ADMIN_USERNAME');
  const displayName = process.env.ADMIN_DISPLAY_NAME ?? 'Administrator';
  const passwordHash = await argon2.hash(required('ADMIN_PASSWORD'), ARGON2_OPTIONS);

  const db = createPrismaClient(required('DATABASE_MIGRATE_URL'));
  try {
    const [{ name } = { name: '' }] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    if (!name.endsWith('_test')) throw new Error(`e2e-reset refuses database "${name}": only a *_test database`);

    const tables = await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    // Names come from the catalogue, quoted; the append-only triggers fire on UPDATE and DELETE, not TRUNCATE.
    const list = tables.map((table) => `"${table.tablename.replaceAll('"', '""')}"`).join(', ');
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`TRUNCATE TABLE ${Prisma.raw(list)} RESTART IDENTITY CASCADE`;
      await tx.orderCounter.create({ data: { id: 1, lastNumber: 0 } });
      await tx.factorySettings.create({ data: { id: 1, factoryName: 'Pallet Factory', phone: '-', address: '-' } });
      await tx.user.create({
        data: { username, displayName, passwordHash, role: 'ADMIN', mustChangePassword: false },
      });
    });
    console.log(`[e2e-reset] ${name}: ${tables.length} tables emptied, admin "${username}" ready`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[e2e-reset] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
