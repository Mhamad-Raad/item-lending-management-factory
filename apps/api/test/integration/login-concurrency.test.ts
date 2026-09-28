import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PasswordService } from '../../src/modules/auth/password.service';
import { MAX_CONCURRENT_VERIFICATIONS } from '../../src/modules/auth/verification-gate';
import { createTestApp } from '../helpers/app';
import { CSRF_HEADER } from '../helpers/auth';
import { TEST_ADMIN, disconnectDatabase, resetDatabase } from '../helpers/db';

/**
 * Q123: a flood of sign-ins cannot take every pool connection, because at most eight password checks — each
 * inside its transaction — run at once. Its own file and addresses: the in-memory throttlers outlive a reset.
 */
describe('concurrent password verifications', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  const attempt = (username: string, password: string, ip: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADER)
      .set('X-Forwarded-For', ip)
      .send({ username, password });

  it('runs at most eight at once and answers every attempt, the right password included', async () => {
    const passwords = app.get(PasswordService);
    let running = 0;
    let peak = 0;
    const track =
      <A extends unknown[], R>(original: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        running += 1;
        peak = Math.max(peak, running);
        try {
          return await original(...args);
        } finally {
          running -= 1;
        }
      };
    const verify = track(passwords.verify.bind(passwords));
    const verifyDummy = track(passwords.verifyDummy.bind(passwords));
    vi.spyOn(passwords, 'verify').mockImplementation(verify);
    vi.spyOn(passwords, 'verifyDummy').mockImplementation(verifyDummy);

    try {
      const answers = await Promise.all([
        ...Array.from({ length: 24 }, (_, i) => attempt(`guess-${i}`, 'wrong-password', `198.51.100.${i + 1}`)),
        attempt(TEST_ADMIN.username, TEST_ADMIN.password, '192.0.2.10'),
      ]);
      expect(answers.slice(0, 24).map((answer) => answer.status)).toEqual(Array(24).fill(401));
      expect(answers[24]?.status).toBe(200);
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_VERIFICATIONS);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
