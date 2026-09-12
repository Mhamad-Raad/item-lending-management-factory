import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';
import { login } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { EMPLOYEE_PASSWORD, createEmployee } from '../helpers/factories';
import { pngImage, uploadImage } from '../helpers/images';

/**
 * S-19. Its own file, because the throttler counts in memory for the lifetime of the application:
 * spending an upload budget here would refuse uploads in every other case.
 */
describe('upload rate limit', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  it('refuses the 11th upload by one user within a minute, and counts each user separately', async () => {
    const image = await pngImage(20, 20);
    const admin = await login(app);

    for (let i = 0; i < 10; i++) await uploadImage(app, admin, 'ITEM_IMAGE', image).expect(201);

    const limited = await uploadImage(app, admin, 'ITEM_IMAGE', image).expect(429);
    expect(limited.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // Same address, different user: the budget is the user's, not the address's.
    const other = await createEmployee(app, ['items.view', 'items.create'], 'second.uploader');
    await uploadImage(app, await login(app, other.username, EMPLOYEE_PASSWORD), 'ITEM_IMAGE', image).expect(201);
  });
});
