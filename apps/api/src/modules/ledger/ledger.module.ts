import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { MoneyLedger } from './money-ledger';

/** The money ledger: its one writer, used by orders now and returns and payments in M4, and its listing. */
@Module({ controllers: [LedgerController], providers: [MoneyLedger, LedgerService], exports: [MoneyLedger] })
export class LedgerModule {}
