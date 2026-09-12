import { Body, Controller, Get, Put } from '@nestjs/common';
import { SettingsUpdateBody, type SettingsDto } from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { AdminOnly, Authenticated } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Everyone signed in reads it: the factory name and logo head every printed receipt. */
  @Get()
  @Authenticated()
  get(): Promise<SettingsDto> {
    return this.settings.get();
  }

  @Put()
  @AdminOnly()
  update(
    @Body(new ZodValidationPipe(SettingsUpdateBody)) body: SettingsUpdateBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<SettingsDto> {
    return this.settings.update(body, actor);
  }
}
