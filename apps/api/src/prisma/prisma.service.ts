import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { ENV, type Env } from '../config/env';

/**
 * Connections the API may hold (Q62). Every mutation holds one for its whole interactive transaction,
 * waiting on row locks when two people touch the same customer or item; with pg's default of 10, a burst
 * of saves made every read in the same moment queue behind them (measured: 10 concurrent orders on one
 * item held 30 concurrent reads ~390 ms). 20 stays far below PostgreSQL's default `max_connections` of 100
 * and inside the database container's memory limit (§13.3), and the scripts keep their own small pools.
 */
export const API_POOL_MAX = 20;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: API_POOL_MAX }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
