/**
 * Deploy-time database step (compose service `migrate`, and `pnpm db:seed` locally):
 *   1. prisma migrate deploy            (as the migration role, DATABASE_MIGRATE_URL)
 *   2. re-apply prisma/sql/grants.sql   (least-privilege grants for the app role)
 *   3. first-run seed: first admin user (mustChangePassword = true) + default factory settings
 * Flags: --seed-only skips steps 1 and 2. Every step is idempotent.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import argon2 from 'argon2';
import { createPrismaClient } from '../prisma/create-client';

const API_ROOT = path.resolve(__dirname, '..', '..');
const PRISMA_BIN = path.join(API_ROOT, 'node_modules', '.bin', 'prisma');

export const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function prisma(args: string[]): void {
  execFileSync(PRISMA_BIN, args, { cwd: API_ROOT, stdio: 'inherit', env: process.env });
}

async function seed(): Promise<void> {
  const db = createPrismaClient(requireEnv('DATABASE_MIGRATE_URL'));
  try {
    const userCount = await db.user.count();
    if (userCount === 0) {
      const username = requireEnv('ADMIN_USERNAME').trim().toLowerCase();
      const password = requireEnv('ADMIN_PASSWORD');
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('ADMIN_USERNAME must match ^[a-z0-9._-]{3,32}$');
      if (password.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters');
      const displayName = process.env.ADMIN_DISPLAY_NAME?.trim() || 'Administrator';

      await db.$transaction(async (tx) => {
        const admin = await tx.user.create({
          data: {
            username,
            displayName,
            passwordHash: await argon2.hash(password, ARGON2_OPTIONS),
            role: 'ADMIN',
            mustChangePassword: true,
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'CREATE',
            entityType: 'USER',
            entityId: String(admin.id),
            summaryKey: 'audit.summary.USER.CREATE',
            summaryParams: { username, seeded: true },
            after: { id: admin.id, username, displayName, role: 'ADMIN', isActive: true, mustChangePassword: true },
          },
        });
      });
      console.log(`[migrate] seeded first admin "${username}" (must change password on first login)`);
    }

    const settings = await db.factorySettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      await db.factorySettings.create({ data: { id: 1, factoryName: 'Pallet Factory', phone: '', address: '' } });
      console.log('[migrate] seeded default factory settings');
    }
  } finally {
    await db.$disconnect();
  }
}

async function main(): Promise<void> {
  const seedOnly = process.argv.includes('--seed-only');
  if (!seedOnly) {
    requireEnv('DATABASE_MIGRATE_URL');
    prisma(['migrate', 'deploy']);
    prisma(['db', 'execute', '--file', path.join('prisma', 'sql', 'grants.sql')]);
  }
  await seed();
}

main().catch((err: unknown) => {
  console.error('[migrate] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
