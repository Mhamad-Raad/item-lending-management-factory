import argon2 from 'argon2';
import { createPrismaClient } from '../../src/prisma/create-client';
import { ARGON2_OPTIONS } from '../../src/modules/auth/password.constants';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client';

/**
 * Every table, truncated between tests as the owner role. The append-only triggers fire on
 * UPDATE and DELETE, not TRUNCATE, so this is the only way to reset ledgers.
 * `assertTableListIsComplete` fails the suite when a migration adds a table that is missing here.
 */
const TABLES = [
  'audit_logs',
  'customers',
  'drivers',
  'factory_settings',
  'idempotency_keys',
  'items',
  'ledger_entries',
  'login_throttles',
  'order_counter',
  'order_lines',
  'orders',
  'purchase_batches',
  'refresh_tokens',
  'return_lines',
  'returns',
  'session_families',
  'stock_movements',
  'uploads',
  'user_permissions',
  'users',
] as const;

export const TEST_ADMIN = { username: 'admin', displayName: 'Administrator', password: 'test-admin-password' } as const;

let ownerClient: PrismaClient | undefined;
let adminPasswordHash: string | undefined;

function owner(): PrismaClient {
  if (!ownerClient) {
    const url = process.env.DATABASE_TEST_MIGRATE_URL;
    if (!url) throw new Error('DATABASE_TEST_MIGRATE_URL is required to run the integration tests');
    ownerClient = createPrismaClient(url);
  }
  return ownerClient;
}

async function assertTableListIsComplete(db: PrismaClient): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const missing = rows.map((row) => row.tablename).filter((name) => !TABLES.includes(name as (typeof TABLES)[number]));
  if (missing.length > 0) throw new Error(`test/helpers/db.ts does not truncate: ${missing.join(', ')}`);
}

/**
 * Empties every table and re-creates the rows the application always expects: the order
 * counter, factory settings and one admin (as `pnpm db:seed` would).
 */
export async function resetDatabase(): Promise<void> {
  const db = owner();
  await assertTableListIsComplete(db);
  // Prisma.raw is safe here: TABLES is a literal list in this file, never user input.
  await db.$executeRaw`TRUNCATE TABLE ${Prisma.raw(TABLES.join(', '))} RESTART IDENTITY CASCADE`;

  adminPasswordHash ??= await argon2.hash(TEST_ADMIN.password, ARGON2_OPTIONS);
  await db.$transaction([
    db.orderCounter.create({ data: { id: 1, lastNumber: 0 } }),
    db.factorySettings.create({ data: { id: 1, factoryName: 'Pallet Factory', phone: '-', address: '-' } }),
    db.user.create({
      data: {
        username: TEST_ADMIN.username,
        displayName: TEST_ADMIN.displayName,
        passwordHash: adminPasswordHash,
        role: 'ADMIN',
        mustChangePassword: false,
      },
    }),
  ]);
}

export async function disconnectDatabase(): Promise<void> {
  await ownerClient?.$disconnect();
  ownerClient = undefined;
}
