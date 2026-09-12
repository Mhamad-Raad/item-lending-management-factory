import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { LedgerModule } from '../ledger/ledger.module';
import { StockModule } from '../stock/stock.module';
import { OrderChangesService } from './order-changes.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [StockModule, LedgerModule, IdempotencyModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderChangesService],
})
export class OrdersModule {}
