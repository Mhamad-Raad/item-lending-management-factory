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
  // Listening once here matters: given a server that is not listening, supertest calls `listen(0)`
  // on it for each request and closes it when that request ends — so of two concurrent requests,
  // one can close the server under the other, and a later request can reach a port handed out
  // again. That showed as a stray 404 or "Parse Error: Expected HTTP/".
  await app.listen(0, '127.0.0.1');
  return app;
}
