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

interface AdminSeed {
  username: string;
  displayName: string;
  passwordHash: string;
}

/** Validates the ADMIN_* variables and hashes the password outside the seeding transaction (Argon2id is slow). */
async function prepareAdmin(): Promise<AdminSeed> {
  const username = requireEnv('ADMIN_USERNAME').trim().toLowerCase();
  const password = requireEnv('ADMIN_PASSWORD');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('ADMIN_USERNAME must match ^[a-z0-9._-]{3,32}$');
  if (password.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters');
  return {
    username,
    displayName: process.env.ADMIN_DISPLAY_NAME?.trim() || 'Administrator',
    passwordHash: await argon2.hash(password, ARGON2_OPTIONS),
  };
}

/** First-run seed (section 13.3): first admin and default factory settings, both in one transaction. */
async function seed(): Promise<void> {
  const db = createPrismaClient(requireEnv('DATABASE_MIGRATE_URL'));
  try {
    const [userCount, settings] = await Promise.all([
      db.user.count(),
      db.factorySettings.findUnique({ where: { id: 1 } }),
    ]);
    const admin = userCount === 0 ? await prepareAdmin() : null;
    if (!admin && settings) return;

    await db.$transaction(async (tx) => {
      if (admin) {
        const created = await tx.user.create({
          data: {
            username: admin.username,
            displayName: admin.displayName,
            passwordHash: admin.passwordHash,
            role: 'ADMIN',
            mustChangePassword: true,
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'CREATE',
            entityType: 'USER',
            entityId: String(created.id),
            summaryKey: 'audit.summary.USER.CREATE',
            summaryParams: { username: admin.username, seeded: true },
            after: {
              id: created.id,
              username: admin.username,
              displayName: admin.displayName,
              role: 'ADMIN',
              isActive: true,
              mustChangePassword: true,
            },
          },
        });
      }
      if (!settings) {
        await tx.factorySettings.create({ data: { id: 1, factoryName: 'Pallet Factory', phone: '-', address: '-' } });
      }
    });

    if (admin) console.log(`[migrate] seeded first admin "${admin.username}" (must change password on first login)`);
    if (!settings) console.log('[migrate] seeded default factory settings');
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
