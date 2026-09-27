import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { createTestApp } from '../helpers/app';
import { CSRF_HEADER, asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { errorCode } from '../helpers/errors';

const NOW = new Date('2026-09-11T09:00:00Z');

/** Codes no business flow happens to produce, pinned to the status and code the web translates (§6.3). */
describe('error codes of the auth and routing edges', () => {
  let app: INestApplication;
  let clock: FixedClock;
  let admin: Session;

  beforeAll(async () => {
    clock = new FixedClock(NOW);
    app = await createTestApp({ clock });
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    clock.set(NOW);
    await resetDatabase();
    admin = await login(app);
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  it('AUTH_REQUIRED: a protected route without a token', async () => {
    const response = await http().get('/api/auth/me').expect(401);
    expect(errorCode(response.body)).toBe('AUTH_REQUIRED');
  });

  it('AUTH_TOKEN_EXPIRED: an access token past its 15 minutes', async () => {
    clock.advance(16 * 60 * 1000);
    const response = await http().get('/api/auth/me').set(asUser(admin)).expect(401);
    expect(errorCode(response.body)).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('AUTH_REFRESH_INVALID: a refresh without a cookie, or with one the server never issued', async () => {
    const missing = await http().post('/api/auth/refresh').set(CSRF_HEADER).expect(401);
    expect(errorCode(missing.body)).toBe('AUTH_REFRESH_INVALID');
    const forged = await http()
      .post('/api/auth/refresh')
      .set(CSRF_HEADER)
      .set('Cookie', 'pallet_rt=not-a-token-the-server-issued')
      .expect(401);
    expect(errorCode(forged.body)).toBe('AUTH_REFRESH_INVALID');
  });

  it('RETURN_NOT_FOUND: deleting a return that does not exist', async () => {
    const response = await http().delete('/api/returns/999999').set(asUser(admin)).expect(404);
    expect(errorCode(response.body)).toBe('RETURN_NOT_FOUND');
  });

  it('ROUTE_NOT_FOUND: an address the API does not have', async () => {
    const response = await http().get('/api/no-such-route').set(asUser(admin)).expect(404);
    expect(errorCode(response.body)).toBe('ROUTE_NOT_FOUND');
  });
});
