import { Controller, Get } from '@nestjs/common';
import type { DashboardDto } from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Authenticated } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Every signed-in user; the sections are gated in the service (§6.22). */
  @Get()
  @Authenticated()
  get(@CurrentUser() actor: AuthContext): Promise<DashboardDto> {
    return this.dashboard.get(actor);
  }
}
