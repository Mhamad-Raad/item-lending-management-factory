import type { INestApplication } from '@nestjs/common';
import { toSafeMoney } from '../../src/common/utils/money';
import { MoneyLedger } from '../../src/modules/ledger/money-ledger';
import { recomputeOrder } from '../../src/modules/orders/order-state';
import { PrismaService } from '../../src/prisma/prisma.service';
import { runInTransaction } from '../../src/prisma/transaction';

/**
 * A manual payment written through the same ledger writer and recompute an operation uses, standing in
 * for `POST /api/orders/:orderId/payments` until M4 builds it. Returns the ledger row's id.
 */
export async function recordManualPayment(
  app: INestApplication,
  options: { orderId: number; amount: number; date: string },
): Promise<number> {
  const prisma = app.get(PrismaService);
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
  return runInTransaction(prisma, async (tx) => {
    const entry = await app
      .get(MoneyLedger)
      .record(
        tx,
        { orderId: options.orderId, type: 'PAYMENT', source: 'MANUAL', amount: options.amount, date: options.date },
        admin.id,
      );
    await recomputeOrder(tx, options.orderId, { bumpVersion: true });
    return entry.id;
  });
}

/** Reverses a manual payment, standing in for `POST /api/ledger-entries/:id/reverse` until M4. */
export async function reverseManualPayment(app: INestApplication, entryId: number, date: string): Promise<void> {
  const prisma = app.get(PrismaService);
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
  await runInTransaction(prisma, async (tx) => {
    const payment = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } });
    await app.get(MoneyLedger).record(
      tx,
      {
        orderId: payment.orderId,
        type: 'PAYMENT_REVERSAL',
        source: 'PAYMENT_DELETE',
        amount: toSafeMoney(payment.amount),
        date,
        reversesEntryId: payment.id,
      },
      admin.id,
    );
    await recomputeOrder(tx, payment.orderId, { bumpVersion: true });
  });
}

/**
 * A return of accepted pallets on one order line that was later deleted (reversed), standing in for
 * M4's return endpoints. It writes only the return rows — no refund, no stock — which is all a test of
 * what a reversed return leaves behind needs.
 */
export async function recordReversedReturn(
  app: INestApplication,
  options: { orderId: number; orderLineId: number; accepted: number; date: string },
): Promise<void> {
  const prisma = app.get(PrismaService);
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
  const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: options.orderLineId } });
  const order = await prisma.order.findUniqueOrThrow({ where: { id: options.orderId } });
  const refundDue = BigInt(options.accepted) * line.unitDeposit;
  const cashRefund = refundDue > order.owed ? refundDue - order.owed : 0n;
  await prisma.palletReturn.create({
    data: {
      orderId: options.orderId,
      date: new Date(`${options.date}T00:00:00.000Z`),
      refundDue,
      owedBefore: order.owed,
      cashRefund,
      createdByUserId: admin.id,
      reversedAt: new Date(),
      reversedByUserId: admin.id,
      reversalKind: 'DELETE',
      lines: {
        create: [
          {
            orderLineId: options.orderLineId,
            acceptedQuantity: options.accepted,
            damagedQuantity: 0,
            unitDeposit: line.unitDeposit,
            damagedRefund: 0n,
          },
        ],
      },
    },
  });
}
