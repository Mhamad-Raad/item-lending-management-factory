import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/** Imported by every module with an idempotent creation: orders now, returns and payments in M4. */
@Module({ providers: [IdempotencyService], exports: [IdempotencyService] })
export class IdempotencyModule {}
