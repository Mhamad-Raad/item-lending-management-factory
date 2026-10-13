import type { INestApplication } from '@nestjs/common';
import type { CustomerDto, DriverDto, ItemDto, OrderDetailDto, TransactionsReceiptDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import {
  createCustomer,
  createDriver,
  createItem,
  createOrder,
  recordPayment,
  recordReturn,
} from '../helpers/factories';

const NOW = new Date('2026-09-11T09:00:00Z');
const TODAY = '2026-09-11';
const ORDER_DAY = '2026-09-01';

describe('an order’s transactions receipt (Q139)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let item: ItemDto;
  let customer: CustomerDto;
  let driver: DriverDto;

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
    item = await createItem(app, admin, { name: 'Pallet 120×100', depositPrice: 1_000, stock: 500 });
    customer = await createCustomer(app, admin);
    driver = await createDriver(app, admin);
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const order100 = (paymentType: 'CASH' | 'LENT'): Promise<OrderDetailDto> =>
    createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: ORDER_DAY,
      paymentType,
      lines: [{ itemId: item.id, quantity: 100 }],
    });
  const transactionsOf = async (orderId: number): Promise<TransactionsReceiptDto> =>
    (await http().get(`/api/orders/${orderId}/transactions-receipt`).set(asUser(admin)).expect(200))
      .body as TransactionsReceiptDto;
  const deletePayment = (entryId: number): request.Test =>
    http().post(`/api/ledger-entries/${entryId}/reverse`).set(asUser(admin)).send({}).expect(200);

  it('lists the payments and refunds by the day the money moved, and totals the ones that stand', async () => {
    const order = await order100('LENT');
    const first = await recordPayment(app, admin, { orderId: order.id, amount: 50_000, date: '2026-09-05' });
    // Recorded second, dated earlier: it is listed first.
    const earlier = await recordPayment(app, admin, { orderId: order.id, amount: 10_000, date: '2026-09-03' });
    await deletePayment(earlier);
    const last = await recordPayment(app, admin, { orderId: order.id, amount: 50_000, date: '2026-09-08' });
    // Nothing is owed, so the 25 pallets' credit is paid back in cash.
    const returnId = await recordReturn(app, admin, {
      orderId: order.id,
      date: '2026-09-10',
      lines: [{ orderLineId: order.lines[0]?.id ?? 0, acceptedQuantity: 25 }],
    });
    const refund = await prisma.ledgerEntry.findFirstOrThrow({ where: { returnId, type: 'REFUND' } });
    const number = (id: number): string => String(id).padStart(6, '0');

    expect(await transactionsOf(order.id)).toEqual({
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        orderNumberDisplay: number(order.orderNumber),
        date: ORDER_DAY,
      },
      printedOn: TODAY,
      factory: expect.objectContaining({ logoUrl: null }) as unknown,
      customer: { name: customer.name, phone: customer.phone, address: customer.address },
      // The deleted 10,000 is listed but counts in no total; its reversal row is not listed at all.
      received: 100_000,
      refunded: 25_000,
      owed: 0,
      rowsPerHalf: 6,
      sheets: [
        {
          sheetNumber: 1,
          sheetCount: 1,
          showTotal: true,
          rows: [
            {
              ledgerEntryId: earlier,
              receiptNumberDisplay: number(earlier),
              kind: 'PAYMENT',
              date: '2026-09-03',
              amount: 10_000,
              reversedOn: TODAY,
            },
            {
              ledgerEntryId: first,
              receiptNumberDisplay: number(first),
              kind: 'PAYMENT',
              date: '2026-09-05',
              amount: 50_000,
              reversedOn: null,
            },
            {
              ledgerEntryId: last,
              receiptNumberDisplay: number(last),
              kind: 'PAYMENT',
              date: '2026-09-08',
              amount: 50_000,
              reversedOn: null,
            },
            {
              ledgerEntryId: refund.id,
              receiptNumberDisplay: number(refund.id),
              kind: 'REFUND',
              date: '2026-09-10',
              amount: 25_000,
              reversedOn: null,
            },
          ],
        },
      ],
    });
  });

  it('puts six rows on a sheet and the totals on the last one alone', async () => {
    const order = await order100('LENT');
    const paid: number[] = [];
    for (let day = 2; day <= 8; day += 1) {
      paid.push(await recordPayment(app, admin, { orderId: order.id, amount: 1_000, date: `2026-09-0${day}` }));
    }

    const receipt = await transactionsOf(order.id);
    expect(receipt.sheets.map((sheet) => [sheet.sheetNumber, sheet.sheetCount, sheet.showTotal])).toEqual([
      [1, 2, false],
      [2, 2, true],
    ]);
    expect(receipt.sheets.flatMap((sheet) => sheet.rows.map((row) => row.ledgerEntryId))).toEqual(paid);
    expect(receipt).toMatchObject({ received: 7_000, refunded: 0, owed: 93_000 });
  });

  it('prints a cancelled cash order with its hand-over payment marked, and an order without money as one sheet', async () => {
    const cash = await order100('CASH');
    await http().post(`/api/orders/${cash.id}/cancel`).set(asUser(admin)).send({ version: 1 }).expect(200);

    const cancelled = await transactionsOf(cash.id);
    expect(cancelled.sheets[0]?.rows).toEqual([
      expect.objectContaining({ kind: 'PAYMENT', date: ORDER_DAY, amount: 100_000, reversedOn: TODAY }),
    ]);
    expect(cancelled).toMatchObject({ received: 0, refunded: 0, owed: 0 });

    const lent = await order100('LENT');
    expect((await transactionsOf(lent.id)).sheets).toEqual([
      { sheetNumber: 1, sheetCount: 1, rows: [], showTotal: true },
    ]);
  });

  it('answers 404 for an order that does not exist', async () => {
    const response = await http().get('/api/orders/999999/transactions-receipt').set(asUser(admin)).expect(404);
    expect(response.body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND' } });
  });
});
