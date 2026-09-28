import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthTokenDto, ChangePasswordBody, ErrorDetails, LoginBody, MeDto, MeUpdateBody } from '@pallet/shared';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import type { Prisma, User } from '../../generated/prisma/client';
import { lockUser, lockUserByUsername } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService, recordableUsernameAttempt } from '../audit/audit.service';
import { ACCESS_TOKEN_TTL_MS } from './auth.constants';
import { toMeDto } from './auth.mapper';
import { LoginThrottleService, type LockoutResult } from './login-throttle.service';
import { checkPasswordPolicy } from './password-policy';
import { PasswordService } from './password.service';
import { SessionService, type IssuedToken } from './session.service';
import { VerificationGate } from './verification-gate';
import { runInTransaction } from '../../prisma/transaction';
import { assertVersion, changedFields } from '../../common/utils/versioning';
import { assertDisplayNameFree } from '../users/display-name';

export interface RequestOrigin {
  ip: string;
  userAgent: string | null;
}

export interface AuthResult {
  token: AuthTokenDto;
  refresh: IssuedToken;
}

/** A login refused with a wait: the (ip, username) pair is locked (Q93) or the account's ceiling holds (Q68). */
interface Throttled {
  code: 'LOGIN_THROTTLED' | 'LOGIN_ACCOUNT_THROTTLED';
  retryAfterSeconds: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly clock: Clock,
    private readonly passwords: PasswordService,
    private readonly throttle: LoginThrottleService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly gate: VerificationGate,
  ) {}

  /**
   * §6.8.2. Every path — unknown username, inactive user, locked pair, wrong password — performs
   * exactly one Argon2 verification. A wrong password, an unknown username and an inactive user all
   * answer the same `AUTH_INVALID_CREDENTIALS`. A locked pair answers `LOGIN_THROTTLED` with the wait
   * (Q93), as does the failure that locks it, and the account's ceiling `LOGIN_ACCOUNT_THROTTLED`
   * (Q68). Neither depends on the password or on whether the username exists — the pair is keyed on
   * the typed username and locks an unknown one the same way — so neither reveals them. The pair is
   * checked first, so when both hold the answer is the pair's.
   */
  async login(body: LoginBody, origin: RequestOrigin): Promise<AuthResult> {
    // A failed attempt still writes: its throttle counter and its audit row. Those must commit,
    // so the refusal is returned from the transaction and thrown only after it (§6.8.2 step 5).
    const attempt = async (tx: Prisma.TransactionClient): Promise<AuthResult | Throttled | null> => {
      const { username, password } = body;
      // Lock order: the pair, the account-wide row, then the user.
      const throttle = await this.throttle.lock(tx, origin.ip, username);
      const account = await this.throttle.lockAccount(tx, username);
      // Locked before the hash is read: a reset or change committing while this attempt verifies
      // would otherwise be overtaken — the old password would still open a session issued after the
      // `token_version` bump, and a rehash would write the old password back over the new one.
      await lockUserByUsername(tx, username);

      const user = await tx.user.findUnique({
        where: { username },
        include: { permissions: { select: { permissionKey: true } } },
      });

      // Keyed on the typed username whether or not it exists, so the wait reveals no account (Q93).
      const pairRetryAfter = this.throttle.retryAfterSeconds(throttle);
      if (pairRetryAfter !== null) {
        await this.passwords.verifyDummy(password);
        await this.auditLoginFailure(tx, user, username, 'LOCKED');
        return { code: 'LOGIN_THROTTLED', retryAfterSeconds: pairRetryAfter };
      }

      // Past the account's ceiling only an address that has signed in to it before may try (Q68). For a name
      // with no account, an address any account signed in from counts as known, so that from the factory's
      // address a real and an invented name are both let through to the same wrong-password answer (Q122).
      const retryAfterSeconds = this.throttle.retryAfterSeconds(account);
      if (retryAfterSeconds !== null && !(await this.isKnownAddress(tx, user, origin.ip))) {
        await this.passwords.verifyDummy(password);
        await this.auditLoginFailure(tx, user, username, 'ACCOUNT_THROTTLED');
        return { code: 'LOGIN_ACCOUNT_THROTTLED', retryAfterSeconds };
      }

      const valid = user?.isActive ? await this.passwords.verify(user.passwordHash, password) : false;
      if (!user?.isActive) await this.passwords.verifyDummy(password);

      if (!valid || !user) {
        const lockout = await this.throttle.registerFailure(tx, throttle);
        const accountLockout = await this.throttle.registerAccountFailure(tx, account);
        // The reason is recorded for the admin reading the history; it never reaches the client.
        await this.auditLoginFailure(tx, user ?? null, username, user && !user.isActive ? 'INACTIVE' : 'INVALID');
        if (lockout.lockedMinutes !== null) await this.auditLockout(tx, user ?? null, username, lockout, 'ADDRESS');
        if (accountLockout.lockedMinutes !== null) {
          await this.auditLockout(tx, user ?? null, username, accountLockout, 'ACCOUNT');
          // Many addresses guessing at one account is an attack in progress: say so where alerts look.
          // The username stays in the audit row: a mistyped password can land in that field.
          this.logger.warn(
            `login ceiling reached for one account: new addresses held back for ${accountLockout.lockedMinutes} ` +
              `minutes (see LOCKOUT in the history)`,
          );
        }
        // The failure that locks the pair already says how long, as every attempt during the lock will.
        return lockout.lockedMinutes !== null
          ? { code: 'LOGIN_THROTTLED', retryAfterSeconds: lockout.lockedMinutes * 60 }
          : null;
      }

      await this.throttle.clear(tx, origin.ip, username);
      await tx.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: this.clock.now(),
          // A hash made with older parameters is replaced while the password is at hand (§10.1 S1).
          ...(this.passwords.needsRehash(user.passwordHash)
            ? { passwordHash: await this.passwords.hash(password) }
            : {}),
        },
      });

      const refresh = await this.sessions.createFamily(tx, user.id, origin.ip, origin.userAgent);
      await this.audit.record(tx, {
        action: 'LOGIN_SUCCESS',
        entityType: 'SESSION',
        entityId: refresh.familyId,
        userId: user.id,
        usernameAttempt: username,
        summaryParams: { username: user.username },
      });

      return { token: this.issueAccessToken(user, toMeDto(user)), refresh };
    };
    // The gate is passed before the transaction opens, so a waiting attempt holds no connection (Q123).
    const result = await this.gate.run(() => runInTransaction(this.prisma, attempt));

    if (!result) throw new ApiError('AUTH_INVALID_CREDENTIALS');
    if (!('token' in result)) {
      const { code, retryAfterSeconds } = result;
      throw new ApiError(code, {
        retryAfterSeconds,
        retryAfterMinutes: Math.ceil(retryAfterSeconds / 60),
      } satisfies ErrorDetails<'LOGIN_THROTTLED'>);
    }
    return result;
  }

  /**
   * §6.8.3: rotation, grace window and reuse detection live in `SessionService`. Reuse revokes the
   * family and audits it, so — as with login — the refusal is thrown after the transaction commits.
   */
  async refresh(presented: string | undefined, ip: string): Promise<AuthResult> {
    if (!presented) throw new ApiError('AUTH_REFRESH_INVALID');

    const result = await runInTransaction(this.prisma, async (tx): Promise<AuthResult | null> => {
      const rotation = await this.sessions.rotate(tx, presented, ip);
      if (!rotation.ok) return null;

      const family = await tx.sessionFamily.findUniqueOrThrow({ where: { id: rotation.token.familyId } });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: family.userId },
        include: { permissions: { select: { permissionKey: true } } },
      });

      return { token: this.issueAccessToken(user, toMeDto(user)), refresh: rotation.token };
    });

    if (!result) throw new ApiError('AUTH_REFRESH_INVALID');
    return result;
  }

  /** Logging out is never an error: an absent or unknown cookie still clears and answers 204. */
  async logout(presented: string | undefined): Promise<void> {
    if (!presented) return;

    await runInTransaction(this.prisma, async (tx) => {
      const family = await this.sessions.lockFamilyByToken(tx, presented);
      if (!family || family.revokedAt) return;

      const user = await tx.user.findUniqueOrThrow({ where: { id: family.userId } });
      await this.sessions.revokeFamily(tx, family.id, 'LOGOUT');
      await this.audit.record(tx, {
        action: 'LOGOUT',
        entityType: 'SESSION',
        entityId: family.id,
        userId: user.id,
        summaryParams: { username: user.username },
      });
    });
  }

  async logoutAll(userId: number): Promise<void> {
    await runInTransaction(this.prisma, async (tx) => {
      await lockUser(tx, userId);
      await this.sessions.logoutEverywhere(tx, await tx.user.findUniqueOrThrow({ where: { id: userId } }));
    });
  }

  /**
   * §6.8.6. Ends with a fresh family so the tab that changed the password stays signed in. Wrong
   * current passwords count on the login throttle's (ip, username) pair and on the account's ceiling
   * (Q69): a stolen access token must not become a password oracle, from one address or from many.
   */
  async changePassword(userId: number, body: ChangePasswordBody, origin: RequestOrigin): Promise<AuthResult> {
    // The username names the throttle pair, which is locked before the user row as in login.
    const { username } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true },
    });

    // A wrong guess must still commit its count, so the refusal leaves the transaction as a value.
    const attempt = async (tx: Prisma.TransactionClient): Promise<AuthResult | ApiError> => {
      // Login's lock order: the pair, the account-wide row, then the user.
      const throttle = await this.throttle.lock(tx, origin.ip, username);
      const account = await this.throttle.lockAccount(tx, username);
      await lockUser(tx, userId);
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { permissions: { select: { permissionKey: true } } },
      });

      // A locked pair refuses, as at the login. Past the account's ceiling nobody may try, known
      // address or not: the caller already holds a token, so an address that signed in before proves
      // nothing here, and a thief's guesses spread over many addresses must stop at the ceiling (Q69).
      // The answer names the longer of the two waits.
      const lockedFor = Math.max(
        this.throttle.retryAfterSeconds(throttle) ?? 0,
        this.throttle.retryAfterSeconds(account) ?? 0,
      );
      if (lockedFor > 0) return currentPasswordLocked(lockedFor);

      if (!(await this.passwords.verify(user.passwordHash, body.currentPassword))) {
        const lockout = await this.throttle.registerFailure(tx, throttle);
        const accountLockout = await this.throttle.registerAccountFailure(tx, account);
        if (lockout.lockedMinutes !== null) await this.auditLockout(tx, user, user.username, lockout, 'ADDRESS');
        if (accountLockout.lockedMinutes !== null) {
          await this.auditLockout(tx, user, user.username, accountLockout, 'ACCOUNT');
          this.logger.warn(
            `change-password ceiling reached for one account: current-password checks and new addresses ` +
              `held back for ${accountLockout.lockedMinutes} minutes (see LOCKOUT in the history)`,
          );
        }
        const lockedMinutes = Math.max(lockout.lockedMinutes ?? 0, accountLockout.lockedMinutes ?? 0);
        return lockedMinutes > 0
          ? currentPasswordLocked(lockedMinutes * 60)
          : new ApiError('CURRENT_PASSWORD_INCORRECT');
      }
      await this.throttle.clear(tx, origin.ip, username);

      const policyFailure = checkPasswordPolicy(body.newPassword, user.username);
      if (policyFailure) throw new ApiError(policyFailure);

      if (await this.passwords.verify(user.passwordHash, body.newPassword)) {
        throw new ApiError('PASSWORD_SAME_AS_CURRENT');
      }

      await this.sessions.revokeAllFamilies(tx, userId, 'PASSWORD_CHANGED');
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: await this.passwords.hash(body.newPassword),
          mustChangePassword: false,
          tokenVersion: { increment: 1 },
        },
        include: { permissions: { select: { permissionKey: true } } },
      });

      const refresh = await this.sessions.createFamily(tx, userId, origin.ip, origin.userAgent);
      await this.audit.record(tx, {
        action: 'PASSWORD_CHANGE',
        entityType: 'USER',
        entityId: String(userId),
        summaryParams: { username: user.username },
      });

      return { token: this.issueAccessToken(updated, toMeDto(updated)), refresh };
    };
    // As at the login: queued before the transaction, verifying inside it (Q123).
    const result = await this.gate.run(() => runInTransaction(this.prisma, attempt));

    if (result instanceof ApiError) throw result;
    return result;
  }

  /**
   * `PATCH /api/auth/me` (Q94): the caller renames themselves — their own row only, and only the
   * display name. Recorded as the admin's rename is (`UPDATE` on `USER`), so the history reads the
   * same whoever made the change. The token carries no name, so the session is left as it is.
   */
  async updateOwnProfile(userId: number, body: MeUpdateBody): Promise<MeDto> {
    return runInTransaction(this.prisma, async (tx) => {
      await lockUser(tx, userId);
      const before = await tx.user.findUnique({
        where: { id: userId },
        include: { permissions: { select: { permissionKey: true } } },
      });
      // Deactivated between the guard and the lock: the session is no longer good for anything.
      if (!before?.isActive) throw new ApiError('AUTH_TOKEN_INVALID');
      assertVersion(before.version, body.version);

      // Q37: a save that changes nothing writes nothing — no version bump, no history row.
      if (changedFields(body, before, ['displayName'] as const).length === 0) return toMeDto(before);
      // Q121: nobody may take a colleague's name, the way an admin could not give it to them.
      await assertDisplayNameFree(tx, body.displayName, userId);

      const after = await tx.user.update({
        where: { id: userId },
        data: { displayName: body.displayName, version: { increment: 1 } },
        include: { permissions: { select: { permissionKey: true } } },
      });

      await this.audit.record(tx, {
        action: 'UPDATE',
        entityType: 'USER',
        entityId: String(userId),
        summaryParams: { username: before.username, fields: ['displayName'] },
        before: toAuditSnapshot('USER', before),
        after: toAuditSnapshot('USER', after),
      });

      return toMeDto(after);
    });
  }

  private isKnownAddress(tx: Prisma.TransactionClient, user: User | null, ip: string): Promise<boolean> {
    return user ? this.throttle.isKnownAddress(tx, user.id, ip) : this.throttle.isAddressKnownToAnyAccount(tx, ip);
  }

  private issueAccessToken(user: User, me: MeDto): AuthTokenDto {
    // `iat` comes from the injected clock so the token's own `exp` and the expiry advertised to
    // the client are the same instant — otherwise neither is testable with a fixed clock.
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    // Algorithm and lifetime come from the JwtModule registration; only the payload is given here.
    const accessToken = this.jwt.sign({ sub: String(user.id), tv: user.tokenVersion, iat: issuedAt });
    return {
      accessToken,
      accessTokenExpiresAt: new Date((issuedAt + ACCESS_TOKEN_TTL_MS / 1000) * 1000).toISOString(),
      user: me,
    };
  }

  private async auditLoginFailure(
    tx: Prisma.TransactionClient,
    user: User | null,
    usernameAttempt: string,
    reason: 'INVALID' | 'LOCKED' | 'INACTIVE' | 'ACCOUNT_THROTTLED',
  ): Promise<void> {
    await this.audit.record(tx, {
      action: 'LOGIN_FAILURE',
      entityType: 'USER',
      entityId: user ? String(user.id) : null,
      userId: user?.id ?? null,
      usernameAttempt,
      // What the history shows is what the column keeps: a typed password never lands in either (Q126).
      summaryParams: { usernameAttempt: recordableUsernameAttempt(usernameAttempt) ?? '—', reason },
    });
  }

  /** `scope` tells the history's reader which limit was reached: one address's, or the account's (Q68). */
  private async auditLockout(
    tx: Prisma.TransactionClient,
    user: User | null,
    usernameAttempt: string,
    lockout: LockoutResult,
    scope: 'ADDRESS' | 'ACCOUNT',
  ): Promise<void> {
    await this.audit.record(tx, {
      action: 'LOCKOUT',
      entityType: 'USER',
      entityId: user ? String(user.id) : null,
      userId: user?.id ?? null,
      usernameAttempt,
      summaryParams: {
        usernameAttempt: recordableUsernameAttempt(usernameAttempt) ?? '—',
        lockedMinutes: lockout.lockedMinutes,
        lockoutCount: lockout.lockoutCount,
        scope,
      },
    });
  }
}

/**
 * The pair is locked out or the account's ceiling holds: how long until the current password may be
 * tried again (Q69).
 */
function currentPasswordLocked(retryAfterSeconds: number): ApiError {
  return new ApiError('CURRENT_PASSWORD_LOCKED', {
    retryAfterSeconds,
    retryAfterMinutes: Math.ceil(retryAfterSeconds / 60),
  });
}
