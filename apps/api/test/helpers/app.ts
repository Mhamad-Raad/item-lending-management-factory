import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { Clock } from '../../src/common/clock';
import { ENV, type Env } from '../../src/config/env';

export interface TestAppOptions {
  /** Replaces the system clock, for lockout backoff and refresh-token window tests. */
  clock?: Clock;
  /** Further overrides, applied before compiling. */
  customise?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * Boots the real application in-process, connected as `pallet_app` to `pallet_test`, with the
 * same Express configuration as production (`configureApp`). Logging is silenced so a failing
 * test shows its assertion rather than a page of request logs.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.clock) builder = builder.overrideProvider(Clock).useValue(options.clock);
  if (options.customise) builder = options.customise(builder);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false, bodyParser: false });

  configureApp(app, app.get<Env>(ENV));
  await app.init();
  return app;
}
