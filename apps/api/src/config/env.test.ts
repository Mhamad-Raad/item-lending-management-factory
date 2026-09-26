import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { jwtSecretProblem, loadEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://pallet_app:secret@localhost:5432/pallet',
  JWT_ACCESS_SECRET: 'x'.repeat(64),
};

/** A production run with a generated secret, so each test varies only what it checks. */
const production = { NODE_ENV: 'production', JWT_ACCESS_SECRET: randomBytes(32).toString('hex') };

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(valid);
    expect(env).toMatchObject({ NODE_ENV: 'development', API_PORT: 3000, COOKIE_SECURE: true });
  });

  it('refuses an insecure refresh cookie in production, and allows it elsewhere (§13.2)', () => {
    expect(() => loadEnv({ ...valid, ...production, COOKIE_SECURE: 'false' })).toThrowError(
      /^Invalid environment configuration: COOKIE_SECURE\n {2}- COOKIE_SECURE: must be true in production$/,
    );
    expect(loadEnv({ ...valid, ...production, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(loadEnv({ ...valid, NODE_ENV: 'development', COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });

  it('rejects a short JWT secret and names the variable without printing any value', () => {
    let message = '';
    try {
      loadEnv({ ...valid, JWT_ACCESS_SECRET: 'short-secret' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^Invalid environment configuration: JWT_ACCESS_SECRET\n/);
    expect(message).toContain('at least 64 characters');
    expect(message).toContain('openssl rand -hex 64');
    expect(message).not.toContain('short-secret');
  });

  const EXAMPLE_PLACEHOLDER = 'change-me-at-least-64-characters-long-random-hex-string-0000000000';
  const DEV_SECRET = 'dev-only-secret-dev-only-secret-dev-only-secret-dev-only-secret-00';

  it('refuses the .env.example placeholder in every environment, without printing it', () => {
    for (const NODE_ENV of ['development', 'test', 'production']) {
      let message = '';
      try {
        loadEnv({ ...valid, ...production, NODE_ENV, JWT_ACCESS_SECRET: EXAMPLE_PLACEHOLDER });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('JWT_ACCESS_SECRET: is still the placeholder from .env.example');
      expect(message).toContain('openssl rand -hex 64');
      expect(message).not.toContain(EXAMPLE_PLACEHOLDER);
    }
  });

  it('keeps the development, CI and live-e2e secrets working outside production', () => {
    for (const secret of [
      DEV_SECRET,
      'ci-only-secret-ci-only-secret-ci-only-secret-ci-only-secret-0000000',
      'live-e2e-only-secret-live-e2e-only-secret-live-e2e-only-secret-00',
      'a'.repeat(64),
    ]) {
      expect(loadEnv({ ...valid, NODE_ENV: 'development', JWT_ACCESS_SECRET: secret }).JWT_ACCESS_SECRET).toBe(secret);
      expect(loadEnv({ ...valid, NODE_ENV: 'test', JWT_ACCESS_SECRET: secret }).JWT_ACCESS_SECRET).toBe(secret);
    }
  });

  it('refuses public and predictable secrets in production', () => {
    expect(jwtSecretProblem(DEV_SECRET, 'production')).toMatch(/published in the repository/);
    expect(jwtSecretProblem('x'.repeat(64), 'production')).toMatch(/too predictable/);
    expect(jwtSecretProblem('0123456789abcdef'.repeat(4), 'production')).toMatch(/too predictable/);
    expect(jwtSecretProblem(`${'a'.repeat(20)}${'0123456789abcdef'.repeat(3)}`, 'production')).toMatch(
      /too predictable/,
    );
    expect(() => loadEnv({ ...valid, ...production, JWT_ACCESS_SECRET: 'x'.repeat(64) })).toThrowError(
      /^Invalid environment configuration: JWT_ACCESS_SECRET\n/,
    );
  });

  it('accepts a generated secret in production', () => {
    for (let i = 0; i < 200; i++) {
      const secret = randomBytes(32).toString('hex');
      expect(jwtSecretProblem(secret, 'production')).toBeNull();
    }
    expect(jwtSecretProblem(randomBytes(64).toString('hex'), 'production')).toBeNull();
    expect(loadEnv({ ...valid, ...production }).NODE_ENV).toBe('production');
  });
});
