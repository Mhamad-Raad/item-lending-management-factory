import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { Env } from './config/env';

/**
 * Express-level configuration shared by `main.ts` and the integration test harness, so the
 * app under test behaves exactly like the deployed one (prefix, proxy trust, cookies).
 */
export function configureApp(app: NestExpressApplication, env: Env): void {
  // Real client IP comes only from Caddy's X-Forwarded-For (pinned compose subnet).
  app.set('trust proxy', env.TRUST_PROXY_SUBNET);
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.setGlobalPrefix('api');
}
