import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  IdParam,
  LedgerEntryListQuery,
  type CustomerReturnReceiptDto,
  type LedgerEntryDto,
  type MoneyReceiptDto,
  type PageDto,
  type TransactionsReceiptDto,
} from '@pallet/shared';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { LedgerService } from './ledger.service';

/**
 * §6.21: the money ledger's listing and its receipts — one row's (Q137), an order's all together (Q139), and a
 * customer return's over its orders (Q161).
 */
@Controller()
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('ledger-entries')
  @RequirePermission('orders.view')
  list(
    @Query(new ZodValidationPipe(LedgerEntryListQuery)) query: LedgerEntryListQuery,
  ): Promise<PageDto<LedgerEntryDto>> {
    return this.ledger.list(query);
  }

  @Get('ledger-entries/:id/receipt')
  @RequirePermission('orders.view')
  receipt(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<MoneyReceiptDto> {
    return this.ledger.receipt(id);
  }

  @Get('customer-returns/:id/receipt')
  @RequirePermission('orders.view')
  customerReturnReceipt(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<CustomerReturnReceiptDto> {
    return this.ledger.customerReturnReceipt(id);
  }

  @Get('orders/:id/transactions-receipt')
  @RequirePermission('orders.view')
  transactionsReceipt(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<TransactionsReceiptDto> {
    return this.ledger.transactionsReceipt(id);
  }
}
