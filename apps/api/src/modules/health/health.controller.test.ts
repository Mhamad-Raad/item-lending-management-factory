import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { ENV } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { HealthController, MIN_FREE_DISK_BYTES } from './health.controller';

const { statfs } = vi.hoisted(() => ({ statfs: vi.fn() }));
vi.mock('node:fs/promises', () => ({ statfs }));

const MiB = 1024 * 1024;
const disk = (freeBytes: number) => statfs.mockResolvedValue({ bavail: freeBytes / MiB, bsize: MiB });

describe('GET /api/health', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: vi.fn() };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ENV, useValue: { APP_VERSION: 'test', UPLOADS_DIR: '/data/uploads' } },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    disk(MIN_FREE_DISK_BYTES * 4);
  });

  afterEach(async () => {
    await app.close();
    vi.resetAllMocks();
  });

  it('returns ok when the database answers and the disk has room', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok', disk: 'ok', version: 'test' });
    expect(statfs).toHaveBeenCalledWith('/data/uploads');
  });

  it('returns 503 SERVICE_UNAVAILABLE with the standard error body when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const res = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(res.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', details: { reason: 'database' } });
    expect(res.body).toHaveProperty('requestId');
  });

  it('returns 503 when the uploads volume is nearly full, although the database still answers (Q61)', async () => {
    disk(MIN_FREE_DISK_BYTES - 1);
    const res = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(res.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', details: { reason: 'disk' } });

    disk(MIN_FREE_DISK_BYTES);
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });

  it('treats an unreadable uploads directory as a full disk', async () => {
    statfs.mockRejectedValue(new Error('ENOENT'));
    const res = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(res.body.error.details).toEqual({ reason: 'disk' });
  });

  it('maps unknown routes to ROUTE_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
