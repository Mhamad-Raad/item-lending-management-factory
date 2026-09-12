import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { createItem } from '../helpers/factories';

const HELD_MS = 6_000;

describe('transactions (§6.6)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    admin = await login(app);
  });

  // Prisma's own default would end the waiting transaction after 5 s with a 500; §6.6 allows 15 s,
  // because waiting for a row lock is the design, not a failure.
  it('lets an operation wait behind a row lock for longer than 5 s', async () => {
    const item = await createItem(app, admin, { stock: 10 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM items WHERE id = ${item.id} FOR UPDATE`;
        await held;
      },
      { timeout: 30_000 },
    );
    setTimeout(release, HELD_MS);

    const response = await request(app.getHttpServer())
      .post(`/api/items/${item.id}/stock-adjustments`)
      .set(asUser(admin))
      .send({ quantity: 1, note: 'Yard recount' });
    await holder;

    expect(response.status).toBe(201);
  }, 30_000);
});
