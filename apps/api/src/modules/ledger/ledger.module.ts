import { Module } from '@nestjs/common';
import { MoneyLedger } from './money-ledger';

/** Imported by every module that moves money: orders now, returns and payments in M4. */
@Module({ providers: [MoneyLedger], exports: [MoneyLedger] })
export class LedgerModule {}
