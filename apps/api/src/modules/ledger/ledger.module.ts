import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { MoneyLedger } from './money-ledger';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/** The money ledger: its one writer, the manual payments written through it, and its listing. */
@Module({
  imports: [IdempotencyModule],
  controllers: [LedgerController, PaymentsController],
  providers: [MoneyLedger, LedgerService, PaymentsService],
  exports: [MoneyLedger],
})
export class LedgerModule {}
