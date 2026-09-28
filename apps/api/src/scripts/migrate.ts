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
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@pallet/shared';
import { toAuditSnapshot } from '../modules/audit/audit-snapshot';
import { AuditService } from '../modules/audit/audit.service';
import { ARGON2_OPTIONS } from '../modules/auth/password.constants';
import { checkPasswordPolicy } from '../modules/auth/password-policy';
import { createPrismaClient } from '../prisma/create-client';

const API_ROOT = path.resolve(__dirname, '..', '..');
const PRISMA_BIN = path.join(API_ROOT, 'node_modules', '.bin', 'prisma');

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

/**
 * Passwords published in this (public) repository: the `.env.example` placeholder's marker, and the
 * development, CI and live-e2e values. The placeholder is refused everywhere; the others only under
 * production, where they would make the first admin's password a matter of public record (Q120).
 */
const PLACEHOLDER_MARKER = 'change-me';
const PUBLIC_PASSWORDS = new Set(['admin-dev-password', 'ci-admin-password-123', 'e2e-admin-password-2026']);

/**
 * Why `ADMIN_PASSWORD` cannot seed the first admin, or null. The admin must change it at the first sign-in,
 * but until then the account is open to anyone who knows it: a public value, or one the login's own policy
 * would refuse (length, the bundled common-password list, the username itself), is refused before anything
 * is written. Wording is for the operator reading the migrate container's log.
 */
export function adminPasswordProblem(password: string, username: string, nodeEnv: string | undefined): string | null {
  const lower = password.toLowerCase();
  if (lower.includes(PLACEHOLDER_MARKER)) {
    return 'is still the .env.example placeholder; set a long random one (`openssl rand -hex 16`) and run again';
  }
  if (nodeEnv === 'production' && PUBLIC_PASSWORDS.has(lower)) {
    return 'is a development/CI value published in the repository; set a long random one and run again';
  }
  switch (checkPasswordPolicy(password, username)) {
    case 'PASSWORD_TOO_SHORT':
      return `must be at least ${PASSWORD_MIN_LENGTH} characters`;
    case 'PASSWORD_TOO_LONG':
      return `must be at most ${PASSWORD_MAX_LENGTH} characters`;
    case 'PASSWORD_TOO_COMMON':
      return 'is a commonly used password or equals ADMIN_USERNAME; choose a long random one';
    default:
      return null;
  }
}

/** Validates the ADMIN_* variables and hashes the password outside the seeding transaction (Argon2id is slow). */
async function prepareAdmin(): Promise<AdminSeed> {
  const username = requireEnv('ADMIN_USERNAME').trim().toLowerCase();
  const password = requireEnv('ADMIN_PASSWORD');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('ADMIN_USERNAME must match ^[a-z0-9._-]{3,32}$');
  const problem = adminPasswordProblem(password, username, process.env.NODE_ENV);
  if (problem) throw new Error(`ADMIN_PASSWORD ${problem}`);
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
        await new AuditService().record(tx, {
          action: 'CREATE',
          entityType: 'USER',
          entityId: String(created.id),
          summaryParams: { username: admin.username, seeded: true },
          after: toAuditSnapshot('USER', created),
          // No request context in a script: the row is attributed to nobody, as §13.3 requires.
          userId: null,
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

// Guarded so the module can be imported (the test helpers reuse its constants) without running.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('[migrate] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
