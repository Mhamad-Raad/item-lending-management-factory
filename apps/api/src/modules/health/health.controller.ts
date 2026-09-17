import { statfs } from 'node:fs/promises';
import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthDto } from '@pallet/shared';
import { Public } from '../../common/decorators/access.decorators';
import { ApiError } from '../../common/errors/api-error';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Free space on the uploads volume below which the API reports itself unavailable (§6.25, Q61). On the
 * single VPS the uploads volume and the database share one disk, and a full disk stops every write while
 * `SELECT 1` keeps answering — the healthcheck, the deploy wait and the uptime monitor would all stay green.
 */
export const MIN_FREE_DISK_BYTES = 256 * 1024 * 1024;

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** GET /api/health — used by the Docker healthcheck, deploy script and uptime monitor. */
  @Get()
  @Public()
  async check(): Promise<HealthDto> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ApiError('SERVICE_UNAVAILABLE', { reason: 'database' });
    }
    if ((await this.freeDiskBytes()) < MIN_FREE_DISK_BYTES) {
      throw new ApiError('SERVICE_UNAVAILABLE', { reason: 'disk' });
    }
    return { status: 'ok', db: 'ok', disk: 'ok', version: this.env.APP_VERSION };
  }

  /** Bytes an unprivileged writer may still use on the uploads volume; a missing directory counts as none. */
  private async freeDiskBytes(): Promise<number> {
    try {
      const stats = await statfs(this.env.UPLOADS_DIR);
      return stats.bavail * stats.bsize;
    } catch {
      return 0;
    }
  }
}
