import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { ENV } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('GET /api/health', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: vi.fn() };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ENV, useValue: { APP_VERSION: 'test' } },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.resetAllMocks();
  });

  it('returns ok when the database answers', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok', version: 'test' });
  });

  it('returns 503 SERVICE_UNAVAILABLE with the standard error body when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const res = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(res.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE' });
    expect(res.body).toHaveProperty('requestId');
  });

  it('maps unknown routes to ROUTE_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
