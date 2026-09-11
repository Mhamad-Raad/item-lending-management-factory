import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { disconnectDatabase, resetDatabase } from '../helpers/db';

/** SQLSTATE 42501 = insufficient_privilege; Prisma surfaces it in the error message. */
async function expectDenied(run: () => Promise<unknown>): Promise<void> {
  await expect(run()).rejects.toThrow(/permission denied/i);
}

/**
 * S-18. The application role must be unable to rewrite history even if the API is compromised:
 * the guarantee is the grant table, not the code that respects it.
 */
describe('database privileges of the application role', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  it('connects as pallet_app', async () => {
    const rows = await prisma.$queryRaw<{ current_user: string }[]>`SELECT current_user`;

    expect(rows[0]?.current_user).toBe('pallet_app');
  });

  it('cannot update or delete audit rows', async () => {
    await expectDenied(() => prisma.$executeRaw`UPDATE audit_logs SET ip = '0.0.0.0'`);
    await expectDenied(() => prisma.$executeRaw`DELETE FROM audit_logs`);
  });

  it('cannot rewrite the money or stock ledgers', async () => {
    await expectDenied(() => prisma.$executeRaw`UPDATE ledger_entries SET amount = 0`);
    await expectDenied(() => prisma.$executeRaw`DELETE FROM stock_movements`);
    await expectDenied(() => prisma.$executeRaw`UPDATE return_lines SET accepted_quantity = 0`);
  });

  it('cannot change what a return recorded', async () => {
    await expectDenied(() => prisma.$executeRaw`UPDATE returns SET refund_due = 0`);
  });
});
