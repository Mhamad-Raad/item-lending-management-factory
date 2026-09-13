import type { INestApplication } from '@nestjs/common';
import { MoneyLedger } from '../../src/modules/ledger/money-ledger';
import { recomputeOrder } from '../../src/modules/orders/order-state';
import { PrismaService } from '../../src/prisma/prisma.service';
import { runInTransaction } from '../../src/prisma/transaction';

/**
 * Rows written around the services, for tests that break an invariant on purpose (reconciliation).
 * Everything else records payments and returns through their endpoints (`recordPayment`,
 * `recordReturn` in factories.ts).
 *
 * A manual payment written through the ledger writer and recompute, without the endpoint's checks —
 * so it can land where the endpoint refuses one, such as a cancelled order. Returns the row's id.
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

/**
 * A reversed return of accepted pallets on one order line, written as bare rows — no refund, no stock —
 * so reconciliation has a return whose cash refund has no REFUND row to find.
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
