import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { PasswordService } from '../../src/modules/auth/password.service';
import { createPrismaClient } from '../../src/prisma/create-client';
import { createTestApp } from '../helpers/app';
import { CSRF_HEADER } from '../helpers/auth';
import { TEST_ADMIN, disconnectDatabase, resetDatabase } from '../helpers/db';

/**
 * A login must not overtake a password reset that commits while it is verifying. Were the account
 * row read without its lock, the old password would still open a fresh session after the reset —
 * one that `token_version` cannot end, because it is issued after the bump.
 */
describe('a login racing a password reset', () => {
  let app: INestApplication;
  let other: PrismaClient;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    other = createPrismaClient(process.env.DATABASE_TEST_URL ?? '');
  });

  afterAll(async () => {
    await other.$disconnect();
    await app.close();
    await disconnectDatabase();
  });

  it('cannot open a session with the password the reset is replacing', async () => {
    const newHash = await app.get(PasswordService).hash('the-password-the-admin-set');
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));

    // Stands in for POST /api/users/:id/reset-password, holding the row until it commits.
    const reset = other.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE username = ${TEST_ADMIN.username} FOR UPDATE`;
        await tx.user.update({
          where: { username: TEST_ADMIN.username },
          data: { passwordHash: newHash, tokenVersion: { increment: 1 } },
        });
        signalLocked();
        await released;
      },
      { timeout: 10_000 },
    );

    await locked;
    const login = request(app.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADER)
      .send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password })
      .then((response) => response);

    // Long enough for an unlocked login to read the old hash and verify it before the commit.
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await reset;

    expect((await login).status).toBe(401);
  });
});
