import { Module } from '@nestjs/common';
import { StockLedger } from './stock-ledger';

/** Imported by every module that moves stock: items and purchases now, orders and returns later. */
@Module({ providers: [StockLedger], exports: [StockLedger] })
export class StockModule {}
