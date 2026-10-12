import { Controller, Get, Param, Query } from '@nestjs/common';
import { IdParam, LedgerEntryListQuery, type LedgerEntryDto, type MoneyReceiptDto, type PageDto } from '@pallet/shared';
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

  @Get(':id/receipt')
  @RequirePermission('orders.view')
  receipt(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<MoneyReceiptDto> {
    return this.ledger.receipt(id);
  }
}
