import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JSON_BODY_LIMIT_BYTES } from '../../src/bootstrap';
import { createTestApp } from '../helpers/app';
import { CSRF_HEADER } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';

/**
 * Body-parser refuses a request before any handler runs, with a plain error rather than a Nest
 * exception. Unmapped, both cases below would answer 500 INTERNAL_ERROR (§6.1.1, §10.4 I2).
 */
describe('request bodies', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  it('refuses a JSON body over 100 KiB with PAYLOAD_TOO_LARGE', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADER)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ username: 'a', password: 'x'.repeat(JSON_BODY_LIMIT_BYTES) }))
      .expect(413);

    expect(response.body).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE', details: { maxBytes: 102_400 } } });
  });

  it('refuses malformed JSON as a validation failure, not a server error', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADER)
      .set('Content-Type', 'application/json')
      .send('{"username": "admin", ')
      .expect(400);

    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('does not parse form-encoded bodies at all', async () => {
    // With no urlencoded parser the body is simply absent, so validation reports the fields missing.
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADER)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('username=admin&password=whatever')
      .expect(400);

    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});
