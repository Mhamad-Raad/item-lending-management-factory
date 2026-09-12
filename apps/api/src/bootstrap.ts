import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { Env } from './config/env';

/** Largest JSON body the API accepts (§6.1.1); larger answers `PAYLOAD_TOO_LARGE`. */
export const JSON_BODY_LIMIT_BYTES = 100 * 1024;

/**
 * Express-level configuration shared by `main.ts` and the integration test harness, so the
 * app under test behaves exactly like the deployed one (prefix, proxy trust, cookies, body
 * limit). The application must be created with `bodyParser: false`: only JSON is parsed here, and
 * no urlencoded parser is ever registered (§10.4 I2).
 */
export function configureApp(app: NestExpressApplication, env: Env): void {
  // Real client IP comes only from Caddy's X-Forwarded-For (pinned compose subnet).
  app.set('trust proxy', env.TRUST_PROXY_SUBNET);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT_BYTES });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
}
