import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { errorCode } from '../helpers/errors';
import { createEmployee } from '../helpers/factories';

/**
 * Q124: the whole factory shares one public address, so the `global` budget (600 a minute) counts per signed-in
 * user on authenticated routes and per address only where nobody is signed in. Its own file: the in-memory
 * counters outlive a database reset and would refuse the other suites' requests.
 */
describe('global rate limit behind a shared address', () => {
  const FACTORY_IP = '203.0.113.40';
  let app: INestApplication;
  let first: Session;
  let second: Session;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    const one = await createEmployee(app, [], 'first.clerk');
    const two = await createEmployee(app, [], 'second.clerk');
    first = await login(app, one.username, one.password, { 'X-Forwarded-For': FACTORY_IP });
    second = await login(app, two.username, two.password, { 'X-Forwarded-For': FACTORY_IP });
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  const me = (session: Pick<Session, 'accessToken'> | null) => {
    const call = request(app.getHttpServer()).get('/api/auth/me').set('X-Forwarded-For', FACTORY_IP);
    return session ? call.set(asUser(session)) : call;
  };

  it('refuses one user past the budget while a colleague at the same address carries on', async () => {
    for (let batch = 0; batch < 12; batch++) {
      const answers = await Promise.all(Array.from({ length: 50 }, () => me(first)));
      expect(answers.every((answer) => answer.status === 200)).toBe(true);
    }
    const limited = await me(first).expect(429);
    expect(errorCode(limited.body)).toBe('RATE_LIMITED');

    // Same address, another user: a budget of their own.
    await me(second).expect(200);
    // Nobody signed in (or a forged token) counts against the address, which the two users never used up.
    await me(null).expect(401);
    const forged = await me({ accessToken: `${first.accessToken.slice(0, -4)}AAAA` }).expect(401);
    expect(errorCode(forged.body)).toBe('AUTH_TOKEN_INVALID');
  });
});
