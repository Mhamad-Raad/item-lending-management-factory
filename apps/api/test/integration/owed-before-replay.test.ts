import type { INestApplication } from '@nestjs/common';
import type { MoneyReceiptDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { replayOwedBefore } from '../../src/modules/ledger/owed-before-replay';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { createCustomer, createDriver, createItem, createOrder } from '../helpers/factories';
import { skipReconciliation } from '../helpers/reconciliation';

skipReconciliation('returns are written as bare rows, without their lines, to place them in time');

const DAY = '2026-09-01';
/** A history laid out by the minute, an hour before now: far enough apart for the replay to order it. */
const START = Date.now() - 3_600_000;
const at = (minutes: number, seconds = 0): Date => new Date(START + minutes * 60_000 + seconds * 1_000);

/**
 * Q137: the payments recorded before `ledger_entries.owed_before` existed have NULL there, and their receipt
 * replays the order. The expected figures are worked by hand from §4.2 (owed = deposit − payments − credits +
 * refunds) at the moment of each payment; the rows are written with their own times, as history would have them.
 */
describe('replaying what was owed before a payment recorded without it (Q137)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let adminId: number;

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
    adminId = (await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } })).id;
  });

  /** A credit order of 100 pallets at 1,000: 100,000 owed. */
  async function lentOrder(): Promise<number> {
    const item = await createItem(app, admin, { name: 'Pallet', depositPrice: 1_000, stock: 1_000 });
    const customer = await createCustomer(app, admin);
    const driver = await createDriver(app, admin);
    const order = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: DAY,
      paymentType: 'LENT',
      lines: [{ itemId: item.id, quantity: 100 }],
    });
    return order.id;
  }

  const legacyPayment = async (orderId: number, amount: number, createdAt: Date): Promise<number> =>
    (
      await prisma.ledgerEntry.create({
        data: {
          orderId,
          type: 'PAYMENT',
          source: 'MANUAL',
          amount: BigInt(amount),
          date: new Date(`${DAY}T00:00:00Z`),
          createdAt,
          createdByUserId: adminId,
        },
      })
    ).id;
  const reversal = (orderId: number, entryId: number, amount: number, createdAt: Date) =>
    prisma.ledgerEntry.create({
      data: {
        orderId,
        type: 'PAYMENT_REVERSAL',
        source: 'PAYMENT_DELETE',
        amount: BigInt(amount),
        date: new Date(`${DAY}T00:00:00Z`),
        reversesEntryId: entryId,
        createdAt,
        createdByUserId: adminId,
      },
    });
  const bareReturn = (orderId: number, refundDue: number, createdAt: Date, reversedAt: Date | null = null) =>
    prisma.palletReturn.create({
      data: {
        orderId,
        date: new Date(`${DAY}T00:00:00Z`),
        refundDue: BigInt(refundDue),
        // Owed at least what it credits, so it pays nothing out (`returns_cash_refund_formula_check`).
        owedBefore: BigInt(refundDue),
        cashRefund: 0n,
        createdAt,
        createdByUserId: adminId,
        ...(reversedAt ? { reversedAt, reversedByUserId: adminId, reversalKind: 'DELETE' as const } : {}),
      },
    });

  it('counts the payments recorded before, and the returns standing, at each payment', async () => {
    const orderId = await lentOrder();
    const first = await legacyPayment(orderId, 20_000, at(0));
    await bareReturn(orderId, 10_000, at(5));
    // Stands from minute 10 to minute 20: it counts for the second payment, not the third.
    await bareReturn(orderId, 30_000, at(10), at(20));
    const second = await legacyPayment(orderId, 15_000, at(15));
    const third = await legacyPayment(orderId, 5_000, at(25));
    // A deleted payment no longer counts for the payments after its deletion.
    await reversal(orderId, third, 5_000, at(28));
    const fourth = await legacyPayment(orderId, 1_000, at(30));

    expect(await replayOwedBefore(prisma, first)).toBe(100_000);
    expect(await replayOwedBefore(prisma, second)).toBe(100_000 - 20_000 - 10_000 - 30_000);
    expect(await replayOwedBefore(prisma, third)).toBe(100_000 - 20_000 - 15_000 - 10_000);
    expect(await replayOwedBefore(prisma, fourth)).toBe(100_000 - 20_000 - 15_000 - 10_000);
  });

  it('answers null where the replay cannot be trusted, and the receipt prints the amount alone', async () => {
    const orderId = await lentOrder();
    // A return within seconds of the payment: the clocks cannot say which came first.
    const close = await legacyPayment(orderId, 1_000, at(0));
    await bareReturn(orderId, 1_000, at(0, 3));

    const orderEdit = (fields: string[], createdAt: Date) =>
      prisma.auditLog.create({
        data: {
          action: 'UPDATE',
          entityType: 'ORDER',
          entityId: String(orderId),
          summaryKey: 'audit.summary.ORDER.UPDATE',
          summaryParams: { fields },
          createdAt,
        },
      });
    // A deleted payment whose order had only its notes edited since: the deposit is the same, so it replays.
    const noted = await legacyPayment(orderId, 500, at(5));
    await reversal(orderId, noted, 500, at(6));
    await orderEdit(['notes'], at(7));
    expect(await replayOwedBefore(prisma, noted)).toBe(100_000 - 1_000 - 1_000);
    // A deleted payment, then an edit of the order's lines: the deposit may have changed since.
    const edited = await legacyPayment(orderId, 2_000, at(10));
    await reversal(orderId, edited, 2_000, at(11));
    await orderEdit(['notes', 'lines'], at(12));
    // A payment that stands replays despite that edit: lines cannot change while it stands.
    const standing = await legacyPayment(orderId, 3_000, at(20));

    expect(await replayOwedBefore(prisma, close)).toBeNull();
    expect(await replayOwedBefore(prisma, edited)).toBeNull();
    expect(await replayOwedBefore(prisma, standing)).toBe(100_000 - 1_000 - 1_000);

    const receipt = (
      await request(app.getHttpServer()).get(`/api/ledger-entries/${close}/receipt`).set(asUser(admin)).expect(200)
    ).body as MoneyReceiptDto;
    expect(receipt).toMatchObject({ amount: 1_000, owedBefore: null, owedAfter: null });
  });

  it('answers null for a payment within seconds of a return being reversed', async () => {
    const orderId = await lentOrder();
    // Created long before, so only its reversal is close: did the payment see its credit or not?
    await bareReturn(orderId, 4_000, at(0), at(30, 2));
    const close = await legacyPayment(orderId, 700, at(30));
    // The control: the same history a minute later replays, the credit gone.
    const later = await legacyPayment(orderId, 300, at(31));

    expect(await replayOwedBefore(prisma, close)).toBeNull();
    expect(await replayOwedBefore(prisma, later)).toBe(100_000 - 700);
  });

  it('answers null for a deleted payment whose order moved stock by a line edit after it', async () => {
    const orderId = await lentOrder();
    const item = await prisma.orderLine.findFirstOrThrow({ where: { orderId } });
    const deleted = await legacyPayment(orderId, 2_000, at(0));
    await reversal(orderId, deleted, 2_000, at(1));
    // No history row says so: the stock movement of the quantity change is enough.
    await prisma.stockMovement.create({
      data: {
        itemId: item.itemId,
        quantity: 10,
        reason: 'ORDER_LINE_EDIT',
        orderId,
        createdAt: at(2),
        createdByUserId: adminId,
      },
    });

    expect(await replayOwedBefore(prisma, deleted)).toBeNull();
  });

  it('never answers below the payment, which was capped at what was owed', async () => {
    const orderId = await lentOrder();
    // Credited more than the deposit before the payment: an impossible history, so no figure.
    await bareReturn(orderId, 100_000, at(0));
    const impossible = await legacyPayment(orderId, 5_000, at(10));

    expect(await replayOwedBefore(prisma, impossible)).toBeNull();
  });
});
