import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { ENV, type Env } from '../../src/config/env';

/**
 * Boots the real application in-process, connected as `pallet_app` to `pallet_test`, with the
 * same Express configuration as production (`configureApp`). Logging is silenced so a failing
 * test shows its assertion rather than a page of request logs.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });

  configureApp(app, app.get<Env>(ENV));
  await app.init();
  return app;
}
