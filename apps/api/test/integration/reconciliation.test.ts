import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { MoneyLedger } from '../../src/modules/ledger/money-ledger';
import { PrismaService } from '../../src/prisma/prisma.service';
import { findLedgerDiscrepancies } from '../../src/prisma/reconciliation';
import { runInTransaction } from '../../src/prisma/transaction';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { createCustomer, createDriver, createItem, createOrder } from '../helpers/factories';
import { recordManualPayment, recordReversedReturn } from '../helpers/ledger-fixtures';

const NOW = new Date('2026-09-11T09:00:00Z');
const TODAY = '2026-09-11';

/**
 * Reconciliation (§4.9 R1–R7): each check is shown to find what it guards, by breaking that invariant
 * on purpose. A clean database reports nothing.
 */
describe('reconciliation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let customerId: number;
  let driverId: number;
  let itemId: number;

  beforeAll(async () => {
    app = await createTestApp({ clock: new FixedClock(NOW) });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    admin = await login(app);
    itemId = (await createItem(app, admin, { depositPrice: 1_000, stock: 500 })).id;
    customerId = (await createCustomer(app, admin)).id;
    driverId = (await createDriver(app, admin)).id;
  });

  const order = (paymentType: 'CASH' | 'LENT', quantity = 10) =>
    createOrder(app, admin, { customerId, driverId, date: TODAY, paymentType, lines: [{ itemId, quantity }] });
  const checks = async (): Promise<string[]> =>
    (await findLedgerDiscrepancies(prisma)).map((found) => `${found.entity}:${found.field}`);

  it('reports nothing for a consistent database', async () => {
    await order('CASH');
    await order('LENT');

    expect(await checks()).toEqual([]);
  });

  it('R3 — a cash order with a manual payment, or without its automatic one', async () => {
    const withManual = await order('CASH');
    const admins = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    // Written without a recompute: a cash order is fully paid, so no operation could ever add this row.
    await runInTransaction(prisma, (tx) =>
      app
        .get(MoneyLedger)
        .record(
          tx,
          { orderId: withManual.id, type: 'PAYMENT', source: 'MANUAL', amount: 1_000, date: TODAY },
          admins.id,
        ),
    );

    const withoutAutomatic = await order('CASH');
    await runInTransaction(prisma, async (tx) => {
      const automatic = await tx.ledgerEntry.findFirstOrThrow({ where: { orderId: withoutAutomatic.id } });
      await app.get(MoneyLedger).record(
        tx,
        {
          orderId: withoutAutomatic.id,
          type: 'PAYMENT_REVERSAL',
          source: 'ORDER_LINE_EDIT',
          amount: 10_000,
          date: TODAY,
          reversesEntryId: automatic.id,
        },
        admins.id,
      );
    });

    expect(await checks()).toEqual(
      expect.arrayContaining(['order:manualPayments', 'order:automaticPayments', 'order:invariant']),
    );
  });

  it('R4 — a cancelled order that still has a standing payment', async () => {
    const lent = await order('LENT');
    await request(app.getHttpServer())
      .post(`/api/orders/${lent.id}/cancel`)
      .set(asUser(admin))
      .send({ version: 1 })
      .expect(200);
    await recordManualPayment(app, { orderId: lent.id, amount: 1_000, date: TODAY });

    expect(await checks()).toContain('order:cancelledPayments');
  });

  it('R5 — order numbers with a gap', async () => {
    await order('LENT');
    await prisma.orderCounter.update({ where: { id: 1 }, data: { lastNumber: 3 } });

    expect(await checks()).toContain('orderCounter:orderNumbers');
  });

  it('R6 — a batch whose movements do not add up to its quantity', async () => {
    const batch = await prisma.purchaseBatch.findFirstOrThrow({ where: { itemId } });
    const admins = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    await prisma.stockMovement.create({
      data: { itemId, quantity: 5, reason: 'BATCH_EDIT', batchId: batch.id, createdByUserId: admins.id },
    });

    expect(await checks()).toContain('batch:movements');
  });

  it('R7 — a return whose cash refund has no REFUND row', async () => {
    const cash = await order('CASH');
    await recordReversedReturn(app, {
      orderId: cash.id,
      orderLineId: cash.lines[0]?.id ?? 0,
      accepted: 5,
      date: TODAY,
    });

    expect(await checks()).toContain('return:refund');
  });
});
