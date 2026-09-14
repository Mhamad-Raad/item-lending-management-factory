import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import type { Prisma, RefreshToken, SessionFamily, SessionRevokeReason, User } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { REFRESH_GRACE_MS, REFRESH_SLIDING_MS, SESSION_ABSOLUTE_MS } from './auth.constants';

export interface IssuedToken {
  value: string;
  expiresAt: Date;
  familyId: string;
  /** Cookie lifetime, from the same clock as `expiresAt` — never `Date.now()`. */
  maxAgeMs: number;
}

/** Only the hash is stored, so a database dump cannot be replayed as a session. */
function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The outcome of a rotation attempt. A refusal is returned rather than thrown because reuse
 * detection *writes* — it revokes the family and audits it — and throwing inside the transaction
 * would roll those writes back with the refusal (§6.8.3 step 5).
 */
export type RotationResult = { ok: true; token: IssuedToken } | { ok: false };

/** Why a family ended; stored on the row so the history can say what happened (§6.8.5). */
export type RevokeReason = SessionRevokeReason;

/**
 * Refresh-token families with rotation, a grace window and reuse detection (§6.8.3). Every method
 * takes the caller's transaction: a session change and the audit row it produces must commit
 * together or not at all.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Starts a new family and its first token (login, and after a password change). */
  async createFamily(
    tx: Prisma.TransactionClient,
    userId: number,
    ip: string,
    userAgent: string | null,
  ): Promise<IssuedToken> {
    const now = this.clock.now();
    const family = await tx.sessionFamily.create({
      data: {
        userId,
        absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
        createdIp: ip,
        userAgent: userAgent?.slice(0, 255) ?? null,
        lastUsedAt: now,
      },
    });
    return this.issue(tx, family, now);
  }

  /**
   * Rotates the token in the cookie and returns the replacement, or refuses — including the reuse
   * case, which revokes the whole family and audits it before refusing.
   */
  async rotate(tx: Prisma.TransactionClient, presented: string, ip: string): Promise<RotationResult> {
    const token = await tx.refreshToken.findUnique({ where: { tokenHash: hashToken(presented) } });
    if (!token) return { ok: false };

    // The family lock serialises two tabs refreshing the same session at the same moment.
    await tx.$queryRaw`SELECT id FROM session_families WHERE id = ${token.familyId}::uuid FOR UPDATE`;
    const family = await tx.sessionFamily.findUniqueOrThrow({ where: { id: token.familyId } });
    const current = await tx.refreshToken.findUniqueOrThrow({ where: { id: token.id } });
    const now = this.clock.now();

    if (family.revokedAt || now >= family.absoluteExpiresAt || now >= current.expiresAt) {
      return { ok: false };
    }

    const user = await tx.user.findUniqueOrThrow({ where: { id: family.userId } });
    if (!user.isActive) {
      await this.revokeFamily(tx, family.id, 'USER_DEACTIVATED');
      return { ok: false };
    }

    if (current.status === 'ACTIVE') {
      await tx.refreshToken.update({ where: { id: current.id }, data: { status: 'ROTATED', rotatedAt: now } });
      await tx.sessionFamily.update({ where: { id: family.id }, data: { lastUsedAt: now } });
      return { ok: true, token: await this.issue(tx, family, now) };
    }

    if (await this.isWithinGraceWindow(tx, current, now)) {
      // The tab that rotated first keeps working; its successor is retired in favour of the new one.
      await tx.refreshToken.updateMany({
        where: { familyId: family.id, status: 'ACTIVE' },
        data: { status: 'RETIRED', rotatedAt: now },
      });
      await tx.sessionFamily.update({ where: { id: family.id }, data: { lastUsedAt: now } });
      return { ok: true, token: await this.issue(tx, family, now) };
    }

    await this.revokeFamily(tx, family.id, 'REUSE_DETECTED');
    await this.audit.record(tx, {
      action: 'SESSION_REUSE_DETECTED',
      entityType: 'SESSION',
      entityId: family.id,
      userId: family.userId,
      summaryParams: { username: user.username, ip },
    });
    return { ok: false };
  }

  /**
   * True only for the most recently rotated token of the family, within the grace window. An older
   * rotated token means someone is replaying a stolen cookie.
   */
  private async isWithinGraceWindow(tx: Prisma.TransactionClient, token: RefreshToken, now: Date): Promise<boolean> {
    if (token.status !== 'ROTATED' || !token.rotatedAt) return false;
    if (now.getTime() - token.rotatedAt.getTime() > REFRESH_GRACE_MS) return false;

    const newest = await tx.refreshToken.findFirst({
      where: { familyId: token.familyId, status: 'ROTATED' },
      // createdAt breaks a tie: two rotations can share a millisecond, and picking the wrong row
      // would let a genuinely stale token pass the grace check instead of raising reuse.
      orderBy: [{ rotatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return newest?.id === token.id;
  }

  async revokeFamily(tx: Prisma.TransactionClient, familyId: string, reason: RevokeReason): Promise<void> {
    await this.revokeFamilies(tx, [familyId], reason);
  }

  /**
   * Logout everywhere (§10.1 S14), for the user themself or by an admin: every live family revoked, every access token
   * issued before voided through `tokenVersion`, and one history row. The caller holds the user's lock.
   */
  async logoutEverywhere(tx: Prisma.TransactionClient, user: Pick<User, 'id' | 'username'>): Promise<void> {
    const families = await this.revokeAllFamilies(tx, user.id, 'LOGOUT_ALL');
    await tx.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
    await this.audit.record(tx, {
      action: 'LOGOUT_ALL',
      entityType: 'USER',
      entityId: String(user.id),
      summaryParams: { username: user.username, families },
    });
  }

  /** Revokes every live family of a user. Returns how many were revoked, for the audit row. */
  async revokeAllFamilies(tx: Prisma.TransactionClient, userId: number, reason: RevokeReason): Promise<number> {
    const families = await tx.sessionFamily.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
    await this.revokeFamilies(
      tx,
      families.map((family) => family.id),
      reason,
    );
    return families.length;
  }

  private async revokeFamilies(tx: Prisma.TransactionClient, familyIds: string[], reason: RevokeReason): Promise<void> {
    if (familyIds.length === 0) return;
    await tx.sessionFamily.updateMany({
      where: { id: { in: familyIds }, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });
    await tx.refreshToken.updateMany({
      where: { familyId: { in: familyIds }, status: { not: 'REVOKED' } },
      data: { status: 'REVOKED' },
    });
  }

  /**
   * Locks the family the token belongs to before returning it, so a concurrent refresh cannot
   * insert a fresh ACTIVE token into a family the caller is about to revoke.
   */
  async lockFamilyByToken(tx: Prisma.TransactionClient, presented: string): Promise<SessionFamily | null> {
    const token = await tx.refreshToken.findUnique({ where: { tokenHash: hashToken(presented) } });
    if (!token) return null;

    await tx.$queryRaw`SELECT id FROM session_families WHERE id = ${token.familyId}::uuid FOR UPDATE`;
    return tx.sessionFamily.findUnique({ where: { id: token.familyId } });
  }

  private async issue(tx: Prisma.TransactionClient, family: SessionFamily, now: Date): Promise<IssuedToken> {
    const value = randomBytes(32).toString('base64url');
    // Sliding lifetime, but never past the family's absolute expiry.
    const expiresAt = new Date(Math.min(now.getTime() + REFRESH_SLIDING_MS, family.absoluteExpiresAt.getTime()));
    await tx.refreshToken.create({
      data: { familyId: family.id, tokenHash: hashToken(value), status: 'ACTIVE', expiresAt },
    });
    return { value, expiresAt, familyId: family.id, maxAgeMs: Math.max(0, expiresAt.getTime() - now.getTime()) };
  }
}
