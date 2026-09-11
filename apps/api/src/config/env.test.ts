import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://pallet_app:secret@localhost:5432/pallet',
  JWT_ACCESS_SECRET: 'x'.repeat(64),
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(valid);
    expect(env).toMatchObject({ NODE_ENV: 'development', API_PORT: 3000, COOKIE_SECURE: true });
  });

  it('rejects a short JWT secret and names the variable without printing any value', () => {
    expect(() => loadEnv({ ...valid, JWT_ACCESS_SECRET: 'short-secret' })).toThrowError(
      /^Invalid environment configuration: JWT_ACCESS_SECRET$/,
    );
  });
});
