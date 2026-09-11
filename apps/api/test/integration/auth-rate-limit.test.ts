import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';
import { disconnectDatabase, resetDatabase } from '../helpers/db';

/**
 * S-3. Lives in its own file because the throttler counts in memory for the lifetime of the
 * application instance: exhausting the login budget here would refuse the other suites' logins.
 */
describe('login rate limit', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  it('refuses the 61st login attempt from one address within a minute', async () => {
    const attempt = (): request.Test =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.9')
        .send({ username: 'nobody', password: 'whatever' });

    // The throttler runs before every other guard, so these cost no password hashing: they are
    // refused for the missing CSRF header, and each one still consumes the login budget.
    for (let i = 0; i < 60; i++) await attempt().expect(403);

    const limited = await attempt().expect(429);
    expect(limited.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(
      (limited.body as { error: { details: { retryAfterSeconds: number } } }).error.details.retryAfterSeconds,
    ).toBeGreaterThan(0);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});
