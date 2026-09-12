import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

@Module({
  imports: [StockModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  // Items record an item's first batch through the same path.
  exports: [PurchasesService],
})
export class PurchasesModule {}
