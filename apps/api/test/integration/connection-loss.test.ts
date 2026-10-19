import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createPrismaClient } from '../../src/prisma/create-client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { runInTransaction } from '../../src/prisma/transaction';
import { createTestApp } from '../helpers/app';
import { disconnectDatabase, resetDatabase } from '../helpers/db';

/** Long enough for the socket's end to reach the pg client while nothing is waiting on it. */
const SETTLE_MS = 200;
const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

/**
 * Q153: PostgreSQL ending a connection the API holds — a database restart, a network blip,
 * `idle_in_transaction_session_timeout` — fails the work on that connection and nothing else. A pg
 * client that loses its socket with no query running emits 'error'; with no listener that event
 * would end the whole process. The adapter listens on the pool (idle clients) and on the client of
 * every interactive transaction, and these tests keep it that way across upgrades.
 */
describe('a database connection ended by the server', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  /** A second connection, as the same role, that ends the API's backends. */
  let killer: PrismaClient;
  const escaped: unknown[] = [];
  const record = (error: unknown) => escaped.push(error);

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    prisma = app.get(PrismaService);
    killer = createPrismaClient(process.env.DATABASE_URL ?? '');
  });

  afterAll(async () => {
    await killer.$disconnect();
    await app.close();
    await disconnectDatabase();
  });

  beforeEach(() => {
    escaped.length = 0;
    process.on('uncaughtException', record);
    process.on('unhandledRejection', record);
  });

  afterEach(() => {
    process.off('uncaughtException', record);
    process.off('unhandledRejection', record);
  });

  const terminate = async (pid: number): Promise<void> => {
    const rows = await killer.$queryRaw<{ ok: boolean }[]>`SELECT pg_terminate_backend(${pid}::int) AS ok`;
    expect(rows[0]?.ok).toBe(true);
  };

  /** Every backend of the application role in this database except the killer's own. */
  const terminateAllOthers = async (): Promise<number> => {
    const rows = await killer.$queryRaw<{ ok: boolean }[]>`
      SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity
      WHERE datname = current_database() AND usename = current_user AND pid <> pg_backend_pid()
    `;
    return rows.filter((row) => row.ok).length;
  };

  const backendPid = async (db: Pick<PrismaClient, '$queryRaw'>): Promise<number> => {
    const rows = await db.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    return rows[0]!.pid;
  };

  /** The API carries on: plain reads, transactions in parallel, and a request through HTTP. */
  const expectUsable = async (): Promise<void> => {
    for (let i = 0; i < 3; i += 1) await expect(backendPid(prisma)).resolves.toBeGreaterThan(0);
    const pids = await Promise.all(Array.from({ length: 5 }, () => runInTransaction(prisma, (tx) => backendPid(tx))));
    expect(pids.every((pid) => pid > 0)).toBe(true);
    await request(app.getHttpServer()).get('/api/health').expect(200);
  };

  it('fails a transaction whose connection ends while it is idle, and only that transaction', async () => {
    let killedPid = 0;

    const outcome = runInTransaction(prisma, async (tx) => {
      killedPid = await backendPid(tx);
      await terminate(killedPid);
      await settle();
      return backendPid(tx);
    });

    await expect(outcome).rejects.toThrow();
    expect(escaped).toEqual([]);
    await expectUsable();
    expect(await backendPid(prisma)).not.toBe(killedPid);
    expect(escaped).toEqual([]);
  });

  it('fails a query whose connection ends while it runs', async () => {
    const outcome = runInTransaction(prisma, async (tx) => {
      const pid = await backendPid(tx);
      const [, result] = await Promise.allSettled([
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          await terminate(pid);
        })(),
        tx.$queryRaw`SELECT pg_sleep(5)`,
      ]);
      if (result.status === 'rejected') throw result.reason;
    });

    await expect(outcome).rejects.toThrow();
    await settle();
    expect(escaped).toEqual([]);
    await expectUsable();
    expect(escaped).toEqual([]);
  });

  it('drops pooled connections that end while idle and opens new ones', async () => {
    // Several connections checked out at once leave several idle in the pool.
    await Promise.all(Array.from({ length: 5 }, () => runInTransaction(prisma, (tx) => backendPid(tx))));

    expect(await terminateAllOthers()).toBeGreaterThanOrEqual(1);
    await settle();

    expect(escaped).toEqual([]);
    await expectUsable();
    expect(escaped).toEqual([]);
  });
});
