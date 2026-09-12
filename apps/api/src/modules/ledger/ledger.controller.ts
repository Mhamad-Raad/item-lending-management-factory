import { Controller, Get, Query } from '@nestjs/common';
import { LedgerEntryListQuery, type LedgerEntryDto, type PageDto } from '@pallet/shared';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { LedgerService } from './ledger.service';

@Controller('ledger-entries')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  @RequirePermission('orders.view')
  list(
    @Query(new ZodValidationPipe(LedgerEntryListQuery)) query: LedgerEntryListQuery,
  ): Promise<PageDto<LedgerEntryDto>> {
    return this.ledger.list(query);
  }
}
