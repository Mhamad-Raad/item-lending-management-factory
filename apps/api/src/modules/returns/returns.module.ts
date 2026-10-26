import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { LedgerModule } from '../ledger/ledger.module';
import { StockModule } from '../stock/stock.module';
import { ReturnsController } from './returns.controller';
import { PalletCreditsController } from './pallet-credits.controller';
import { PalletCreditsService } from './pallet-credits.service';
import { ReturnsService } from './returns.service';

@Module({
  imports: [StockModule, LedgerModule, IdempotencyModule],
  controllers: [ReturnsController, PalletCreditsController],
  providers: [ReturnsService, PalletCreditsService],
  exports: [PalletCreditsService],
})
export class ReturnsModule {}
