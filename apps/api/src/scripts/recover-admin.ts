/**
 * Last-admin recovery (docs/runbooks/last-admin-recovery.md, Q130): gives one user a new temporary password
 * when nobody who could reset it can sign in.
 *
 *   docker compose --profile migrate run --rm migrate node dist/scripts/recover-admin.js <username> [--promote]
 *   pnpm --filter @pallet/api recover-admin <username> [--promote]                        (development)
 * On the server it runs in the one-shot `migrate` container (the API image): `run api` would clash with the running
 * API over the service's fixed network address.
 *
 * The password is read from standard input — typed twice without echo at a terminal, or the first line of a
 * pipe — never from the command line, where `ps` and the shell history would keep it. It must pass the login's
 * password policy. The user is reactivated, must change the password at the next sign-in, is signed out
 * everywhere (every session family revoked, `token_version` bumped) and loses any login throttle; `--promote`
 * also makes them an admin. Everything happens in one transaction as the API's runtime role, with the same
 * services the API uses, and is recorded in the history attributed to nobody (no request, no signed-in user).
 */
import { ROLES, type ErrorCode } from '@pallet/shared';
import { SystemClock, type Clock } from '../common/clock';
import type { PrismaClient } from '../generated/prisma/client';
import { toAuditSnapshot } from '../modules/audit/audit-snapshot';
import { AuditService } from '../modules/audit/audit.service';
import { checkPasswordPolicy } from '../modules/auth/password-policy';
import { PasswordService } from '../modules/auth/password.service';
import { SessionService } from '../modules/auth/session.service';
import { createPrismaClient } from '../prisma/create-client';
import { scrubErrorForLog } from '../sentry-scrub';
import { lockActiveAdmins, lockUser } from '../prisma/locks';
import { runInTransaction } from '../prisma/transaction';

export interface RecoveryRequest {
  username: string;
  password: string;
  promote: boolean;
}

export interface RecoveryResult {
  userId: number;
  role: (typeof ROLES)[number];
  reactivated: boolean;
  promoted: boolean;
  sessionsRevoked: number;
}

/** Why the recovery cannot run, in the operator's words; thrown before anything is written. */
export class RecoveryRefused extends Error {}

const POLICY_MESSAGES: Partial<Record<ErrorCode, string>> = {
  PASSWORD_TOO_SHORT: 'is shorter than 10 characters',
  PASSWORD_TOO_LONG: 'is longer than 128 characters',
  PASSWORD_TOO_COMMON: 'is a commonly used password or equals the username',
};

export async function recoverAdmin(
  db: PrismaClient,
  request: RecoveryRequest,
  clock: Clock = new SystemClock(),
): Promise<RecoveryResult> {
  const username = request.username.trim().toLowerCase();
  const policyFailure = checkPasswordPolicy(request.password, username);
  if (policyFailure) {
    throw new RecoveryRefused(`the new password ${POLICY_MESSAGES[policyFailure] ?? 'is not accepted'}`);
  }

  const audit = new AuditService();
  const sessions = new SessionService(clock, audit);
  // Hashed before the transaction: Argon2 is slow, and the locks below need not wait for it.
  const passwordHash = await new PasswordService().hash(request.password);

  return runInTransaction(db, async (tx) => {
    // The API's lock order for a change of admin power: every active admin, then the user.
    if (request.promote) await lockActiveAdmins(tx);
    const found = await tx.user.findUnique({ where: { username }, select: { id: true } });
    if (!found) throw new RecoveryRefused(`no user is named "${username}" (usernames are listed in the users table)`);
    await lockUser(tx, found.id);
    const before = await tx.user.findUniqueOrThrow({
      where: { id: found.id },
      include: { permissions: { select: { permissionKey: true } } },
    });

    const promoted = request.promote && before.role !== 'ADMIN';
    const reactivated = !before.isActive;
    const sessionsRevoked = await sessions.revokeAllFamilies(tx, before.id, 'PASSWORD_RESET');
    // An admin holds every permission implicitly; a stored set would only be a leftover.
    if (promoted) await tx.userPermission.deleteMany({ where: { userId: before.id } });
    const after = await tx.user.update({
      where: { id: before.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        isActive: true,
        ...(promoted ? { role: 'ADMIN' as const } : {}),
        tokenVersion: { increment: 1 },
        version: { increment: 1 },
      },
      include: { permissions: { select: { permissionKey: true } } },
    });
    // Every throttle row of the name — each address's pair and the account-wide ceiling.
    await tx.loginThrottle.deleteMany({ where: { username } });

    const via = { username, via: 'recover-admin' };
    await audit.record(tx, {
      action: 'PASSWORD_RESET',
      entityType: 'USER',
      entityId: String(after.id),
      summaryParams: via,
    });
    if (reactivated) {
      await audit.record(tx, {
        action: 'USER_ACTIVATE',
        entityType: 'USER',
        entityId: String(after.id),
        summaryParams: via,
        before: toAuditSnapshot('USER', before),
        after: toAuditSnapshot('USER', after),
      });
    }
    if (promoted) {
      await audit.record(tx, {
        action: 'PERMISSION_CHANGE',
        entityType: 'USER',
        entityId: String(after.id),
        summaryParams: { ...via, added: 0, removed: before.permissions.length },
        before: { role: before.role, permissions: before.permissions.map((p) => p.permissionKey).sort() },
        after: { role: after.role, permissions: [] },
      });
    }

    return { userId: after.id, role: after.role, reactivated, promoted, sessionsRevoked };
  });
}

/** One line from a pipe, or a password typed twice without echo at a terminal. */
async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return (Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '').trimEnd();
  }
  const first = await promptHidden('New temporary password: ');
  const second = await promptHidden('Type it again: ');
  if (first !== second) throw new RecoveryRefused('the two passwords differ');
  return first;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = '';
    process.stdout.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const done = (error?: Error): void => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return done();
        if (char === '\u0003') return done(new RecoveryRefused('cancelled'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    input.on('data', onData);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const promote = args.includes('--promote');
  const positional = args.filter((arg) => arg !== '--promote');
  if (positional.length !== 1 || positional[0]?.startsWith('-')) {
    throw new RecoveryRefused('usage: recover-admin.js <username> [--promote]  (the password is read from stdin)');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new RecoveryRefused('DATABASE_URL is not set');

  const password = await readPassword();
  const db = createPrismaClient(url);
  try {
    const result = await recoverAdmin(db, { username: positional[0] ?? '', password, promote });
    console.log(
      `[recover-admin] "${positional[0]?.trim().toLowerCase()}" (${result.role}) has the new temporary password` +
        `${result.promoted ? ', was made an admin' : ''}${result.reactivated ? ', was reactivated' : ''}` +
        ` and was signed out of ${result.sessionsRevoked} session(s). Sign in with it; you will be asked to change it.`,
    );
    if (result.role !== 'ADMIN') {
      console.log('[recover-admin] note: this user is not an admin — add --promote to make them one.');
    }
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    if (error instanceof RecoveryRefused) {
      console.error('[recover-admin] refused:', error.message);
    } else {
      // A database error can quote a connection string: print what `scrubErrorForLog` keeps (Q125).
      const { type, code, message } = scrubErrorForLog(error);
      console.error(`[recover-admin] failed: ${type}${code ? ` ${code}` : ''}: ${message}`);
    }
    process.exit(1);
  });
}
