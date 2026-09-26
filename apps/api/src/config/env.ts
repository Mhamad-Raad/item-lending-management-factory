import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

/** `VAR=` (empty) in an env file means "not set". */
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.url().optional());

const GENERATE_HINT = 'generate one with `openssl rand -hex 64`';

/** Every environment variable the API reads at runtime. Validated once at startup. */
const envSchemaShape = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_VERSION: z.string().default('dev'),
  DATABASE_URL: z.url(),
  /** Express `trust proxy` value: the pinned compose subnet in production. */
  TRUST_PROXY_SUBNET: z.string().default('loopback'),
  JWT_ACCESS_SECRET: z.string().min(64, { message: `must be at least 64 characters; ${GENERATE_HINT}` }),
  COOKIE_SECURE: booleanString.default(true),
  UPLOADS_DIR: z.string().default('./data/uploads'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_DEV_ORIGIN: optionalUrl,
  SENTRY_DSN: optionalUrl,
  SENTRY_ENVIRONMENT: z.string().default('production'),
});

/**
 * Markers of the secrets committed to this public repository (`.env.example`, CI, the live e2e suite):
 * anyone can read them, so a server signing tokens with one lets anyone mint an admin token.
 */
const PUBLIC_SECRET_MARKERS = ['change-me', 'dev-only', 'ci-only', 'e2e-only', 'example'];

/**
 * Why `secret` is unfit to sign access tokens, or `null`. The placeholder is refused everywhere; the rest
 * (public values, low variety, a repeated pattern) only in production, so the development, CI and test
 * values keep working. Never includes the secret itself. `deploy/deploy.sh` mirrors these rules for production
 * (Q67): change both together.
 */
export function jwtSecretProblem(secret: string, nodeEnv: Env['NODE_ENV']): string | null {
  const lower = secret.toLowerCase();
  if (lower.includes('change-me')) return `is still the placeholder from .env.example; ${GENERATE_HINT}`;
  if (nodeEnv !== 'production') return null;
  if (PUBLIC_SECRET_MARKERS.some((marker) => lower.includes(marker))) {
    return `is a development/CI value published in the repository; ${GENERATE_HINT}`;
  }
  // `openssl rand -hex 32` (64 characters) all but never has fewer than 12 distinct characters or one
  // character filling a quarter of the string; a typed or patterned value usually does.
  const counts = new Map<string, number>();
  for (const char of secret) counts.set(char, (counts.get(char) ?? 0) + 1);
  const mostCommon = Math.max(...counts.values());
  if (counts.size < 12 || mostCommon > secret.length / 4 || hasShortPeriod(secret)) {
    return `looks too predictable (too few distinct characters or a repeated pattern); ${GENERATE_HINT}`;
  }
  return null;
}

/** True when `s` is a shorter block (≤ a quarter of its length) repeated, e.g. `abcdabcdabcd…`. */
function hasShortPeriod(s: string): boolean {
  for (let period = 1; period <= s.length / 4; period++) {
    if (s.slice(period) === s.slice(0, s.length - period)) return true;
  }
  return false;
}

const envSchema = envSchemaShape.superRefine((env, ctx) => {
  // §13.2: a production API never issues the refresh cookie without `Secure`, whatever `.env` says.
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production' });
  }
  const problem = jwtSecretProblem(env.JWT_ACCESS_SECRET, env.NODE_ENV);
  if (problem) ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: problem });
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Names and rule messages only — never values (they may be secrets; zod 4 leaves the input out of its
    // messages unless `reportInput` is set, and the custom messages above never include it).
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    const details = parsed.error.issues.map((i) => `\n  - ${i.path.join('.')}: ${i.message}`).join('');
    throw new Error(`Invalid environment configuration: ${names}${details}`);
  }
  return parsed.data;
}
