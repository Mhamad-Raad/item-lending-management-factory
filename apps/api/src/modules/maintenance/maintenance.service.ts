import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A throttle row idle this long is forgotten — including its lockout backoff (§6.8.2). */
export const LOGIN_THROTTLE_RETENTION_MS = DAY_MS;
/** A session family this far past its absolute expiry can never be refreshed again. */
export const SESSION_FAMILY_RETENTION_MS = 30 * DAY_MS;

/**
 * The periodic cleanup of §6.8.2, on plain timers: the API runs as one instance, so a scheduler
 * library would add a dependency for nothing. Both purges are also public so a test — or an
 * operator — can run one on demand. Audit rows about purged sessions stay: the history is
 * append-only and the purge only removes what the tables need for their own work.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private hourly: ReturnType<typeof setInterval> | undefined;
  private daily: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    // `unref` keeps a timer from holding the process open — a test harness would otherwise hang.
    this.hourly = setInterval(() => void this.runSafely('login throttles', () => this.purgeLoginThrottles()), HOUR_MS);
    this.daily = setInterval(() => void this.runSafely('session families', () => this.purgeSessionFamilies()), DAY_MS);
    this.hourly.unref();
    this.daily.unref();

    // Also once now: every deploy restarts the countdown, and a daily job on an API restarted
    // daily would otherwise never run. Not awaited — cleanup must never delay startup.
    void this.runAll();
  }

  onApplicationShutdown(): void {
    clearInterval(this.hourly);
    clearInterval(this.daily);
  }

  /** Forgets every (ip, username) pair that has not failed a login for a day. Returns the count. */
  async purgeLoginThrottles(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - LOGIN_THROTTLE_RETENTION_MS);
    const { count } = await this.prisma.loginThrottle.deleteMany({ where: { updatedAt: { lt: cutoff } } });
    return count;
  }

  /** Removes families long past their absolute expiry; their tokens go with them (ON DELETE CASCADE). */
  async purgeSessionFamilies(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - SESSION_FAMILY_RETENTION_MS);
    const { count } = await this.prisma.sessionFamily.deleteMany({ where: { absoluteExpiresAt: { lt: cutoff } } });
    return count;
  }

  private async runAll(): Promise<void> {
    await this.runSafely('login throttles', () => this.purgeLoginThrottles());
    await this.runSafely('session families', () => this.purgeSessionFamilies());
  }

  private async runSafely(what: string, job: () => Promise<number>): Promise<void> {
    try {
      const removed = await job();
      if (removed > 0) this.logger.log(`purged ${removed} ${what}`);
    } catch (error) {
      // A failed purge is retried on the next tick; it must never take the API down with it.
      this.logger.error(`purge of ${what} failed`, error instanceof Error ? error.stack : String(error));
    }
  }
}
