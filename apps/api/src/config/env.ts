import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

/** `VAR=` (empty) in an env file means "not set". */
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.url().optional());

/** Every environment variable the API reads at runtime. Validated once at startup. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_VERSION: z.string().default('dev'),
  DATABASE_URL: z.url(),
  /** Express `trust proxy` value: the pinned compose subnet in production. */
  TRUST_PROXY_SUBNET: z.string().default('loopback'),
  JWT_ACCESS_SECRET: z.string().min(64),
  COOKIE_SECURE: booleanString.default(true),
  UPLOADS_DIR: z.string().default('./data/uploads'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_DEV_ORIGIN: optionalUrl,
  SENTRY_DSN: optionalUrl,
  SENTRY_ENVIRONMENT: z.string().default('production'),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Names only — never print values (they may be secrets).
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return parsed.data;
}
