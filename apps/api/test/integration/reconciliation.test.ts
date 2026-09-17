import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { MoneyLedger } from '../../src/modules/ledger/money-ledger';
import { PrismaService } from '../../src/prisma/prisma.service';
import { findLedgerDiscrepancies } from '../../src/prisma/reconciliation';
import { runInTransaction } from '../../src/prisma/transaction';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { skipReconciliation } from '../helpers/reconciliation';
import { createCustomer, createDriver, createItem, createOrder } from '../helpers/factories';
import { recordManualPayment, recordReversedReturn } from '../helpers/ledger-fixtures';

const NOW = new Date('2026-09-11T09:00:00Z');
const TODAY = '2026-09-11';

/**
 * Reconciliation (§4.9 R1–R7): each check is shown to find what it guards, by breaking that invariant
 * on purpose. A clean database reports nothing.
 */
skipReconciliation('every test breaks an invariant on purpose');

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

  it('R2 — scans orders in batches by id and still reaches the last one (Q60)', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push((await order(i % 2 ? 'CASH' : 'LENT')).id);
    const last = ids[ids.length - 1]!; // the fifth order is LENT: it owes its 10,000 deposit
    // A wrong cache column on the last order of a partial final batch: only a cursor that walks every
    // batch, and does not stop at the first full one, finds it.
    await prisma.order.update({ where: { id: last }, data: { owed: 1 } });
    const broken = [{ entity: 'order', id: last, field: 'owed', stored: 1, expected: 10_000 }];

    // The batches themselves, not only their result: one order query per batch plus the empty or
    // short one that ends the walk, so a scan that quietly loaded everything at once would show here.
    const batches = async (batchSize: number) => {
      const findMany = vi.spyOn(prisma.order, 'findMany');
      try {
        expect(await findLedgerDiscrepancies(prisma, { batchSize })).toEqual(broken);
        return findMany.mock.calls.map(([args]) => args?.take);
      } finally {
        findMany.mockRestore();
      }
    };
    expect(await batches(2)).toEqual([2, 2, 2]); // 2 + 2 + 1 (short: last)
    expect(await batches(5)).toEqual([5, 5]); // 5 (full) + 0 (empty: last)
    expect(await batches(1)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(await batches(1_000)).toEqual([1_000]);

    await expect(findLedgerDiscrepancies(prisma, { batchSize: 0 })).rejects.toThrow(RangeError);
    await expect(findLedgerDiscrepancies(prisma, { batchSize: 1.5 })).rejects.toThrow(RangeError);
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
