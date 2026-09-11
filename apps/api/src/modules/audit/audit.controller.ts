import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogListQuery, type AuditLogDto, type PageDto } from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditQueryService } from './audit-query.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  /** Read-only by construction: no endpoint updates or deletes audit rows (§11.1). */
  @Get()
  @RequirePermission('audit.view')
  list(
    @Query(new ZodValidationPipe(AuditLogListQuery)) query: AuditLogListQuery,
    @CurrentUser() viewer: AuthContext,
  ): Promise<PageDto<AuditLogDto>> {
    return this.audit.list(query, viewer.canViewCost);
  }
}
