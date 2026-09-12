import { Module } from '@nestjs/common';
import { PurchasesModule } from '../purchases/purchases.module';
import { StockModule } from '../stock/stock.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  imports: [StockModule, UploadsModule, PurchasesModule],
  controllers: [ItemsController],
  providers: [ItemsService],
})
export class ItemsModule {}
