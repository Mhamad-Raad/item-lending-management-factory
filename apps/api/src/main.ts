import './instrument';
import 'reflect-metadata';
import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { ENV, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  // A promise nobody awaited that failed: a bug, but not one to take every other request down with it.
  // Logged here through pino; when Sentry is configured its own unhandled-rejection integration reports it.
  const processLogger = new NestLogger('Process');
  process.on('unhandledRejection', (reason: unknown) => {
    processLogger.error(reason instanceof Error ? reason : new Error(`unhandled rejection: ${String(reason)}`));
  });
  configureApp(app, env);
  app.enableShutdownHooks();

  // Production is same-origin behind Caddy; CORS exists only for an explicit dev origin.
  if (env.NODE_ENV === 'development' && env.CORS_DEV_ORIGIN) {
    app.enableCors({ origin: env.CORS_DEV_ORIGIN, credentials: true });
  }

  await app.listen(env.API_PORT, '0.0.0.0');
}

// Startup failures (invalid configuration, an undeclared route) must stop the container. In
// production only the message is printed — it may list environment variable names — while
// anywhere else the stack is what tells the developer which module failed to resolve.
bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[api] failed to start: ${message}`);
  if (process.env.NODE_ENV !== 'production') console.error(error);
  process.exit(1);
});
