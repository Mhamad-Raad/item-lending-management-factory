import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { disconnectDatabase, resetDatabase } from '../helpers/db';

describe('GET /api/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  it('reports the database as reachable', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(response.body).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('runs as the least-privileged application role', async () => {
    const rows = await app.get(PrismaService).$queryRaw<{ current_user: string }[]>`SELECT current_user`;

    expect(rows[0]?.current_user).toBe('pallet_app');
  });
});
