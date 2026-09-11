import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  // Real client IP comes only from Caddy's X-Forwarded-For (pinned compose subnet).
  app.set('trust proxy', env.TRUST_PROXY_SUBNET);
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  // Production is same-origin behind Caddy; CORS exists only for an explicit dev origin.
  if (env.NODE_ENV === 'development' && env.CORS_DEV_ORIGIN) {
    app.enableCors({ origin: env.CORS_DEV_ORIGIN, credentials: true });
  }

  await app.listen(env.API_PORT, '0.0.0.0');
}

void bootstrap();
