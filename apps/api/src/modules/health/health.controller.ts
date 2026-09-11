import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../../common/decorators/access.decorators';
import { ApiError } from '../../common/errors/api-error';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** GET /api/health — used by the Docker healthcheck, deploy script and uptime monitor. */
  @Get()
  @Public()
  async check(): Promise<{ status: 'ok'; db: 'ok'; version: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ApiError('SERVICE_UNAVAILABLE');
    }
    return { status: 'ok', db: 'ok', version: this.env.APP_VERSION };
  }
}
