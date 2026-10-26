import type { INestApplication } from '@nestjs/common';
import type { CustomerDto, DriverDto, ItemDto, MoneyReceiptDto, OrderDetailDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { TEST_ADMIN, disconnectDatabase, resetDatabase } from '../helpers/db';
import {
  EMPLOYEE_PASSWORD,
  createCustomer,
  createDriver,
  createEmployee,
  createItem,
  createOrder,
  recordPayment,
  recordReturn,
} from '../helpers/factories';

const NOW = new Date('2026-09-11T09:00:00Z');
const TODAY = '2026-09-11';
const ORDER_DAY = '2026-09-01';

describe('payment and refund receipts (Q137)', () => {
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
  const receipt = (entryId: number, session: Session = admin): request.Test =>
    http().get(`/api/ledger-entries/${entryId}/receipt`).set(asUser(session));
  const receiptOf = async (entryId: number): Promise<MoneyReceiptDto> =>
    (await receipt(entryId).expect(200)).body as MoneyReceiptDto;

  it('a payment prints what was owed before and after it, and keeps saying so after later events', async () => {
    const order = await order100('LENT');
    const first = await recordPayment(app, admin, { orderId: order.id, amount: 40_000, date: '2026-09-05' });

    expect(await receiptOf(first)).toEqual({
      ledgerEntryId: first,
      receiptNumberDisplay: String(first).padStart(6, '0'),
      kind: 'PAYMENT',
      date: '2026-09-05',
      printedOn: TODAY,
      amount: 40_000,
      owedBefore: 100_000,
      credit: null,
      owedAfter: 60_000,
      source: 'MANUAL',
      note: null,
      recordedBy: expect.objectContaining({ username: TEST_ADMIN.username }) as unknown,
      reversedOn: null,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        orderNumberDisplay: String(order.orderNumber).padStart(6, '0'),
        date: ORDER_DAY,
      },
      factory: expect.objectContaining({ logoUrl: null }) as unknown,
      customer: { name: customer.name, phone: customer.phone, address: customer.address },
      // A payment lists no pallets: only a refund's return does (Q167).
      lines: [],
    });

    // A return credits 30,000; the next payment starts from what is left.
    await recordReturn(app, admin, {
      orderId: order.id,
      date: TODAY,
      lines: [{ orderLineId: order.lines[0]?.id ?? 0, acceptedQuantity: 30 }],
    });
    const second = await recordPayment(app, admin, { orderId: order.id, amount: 10_000, date: TODAY });

    expect(await receiptOf(second)).toMatchObject({ owedBefore: 30_000, amount: 10_000, owedAfter: 20_000 });
    // The first receipt is the same paper it was.
    expect(await receiptOf(first)).toMatchObject({ owedBefore: 100_000, owedAfter: 60_000, reversedOn: null });
  });

  it('a deleted payment still prints, with the day it was deleted', async () => {
    const order = await order100('LENT');
    const paid = await recordPayment(app, admin, { orderId: order.id, amount: 25_000, date: TODAY });
    await http().post(`/api/ledger-entries/${paid}/reverse`).set(asUser(admin)).send({}).expect(200);

    expect(await receiptOf(paid)).toMatchObject({ amount: 25_000, owedBefore: 100_000, reversedOn: TODAY });
  });

  it('a cash order’s automatic payment is the whole deposit, on the order’s date; cancelling marks it', async () => {
    const order = await order100('CASH');
    const automatic = await prisma.ledgerEntry.findFirstOrThrow({ where: { orderId: order.id, type: 'PAYMENT' } });

    expect(await receiptOf(automatic.id)).toMatchObject({
      kind: 'PAYMENT',
      date: ORDER_DAY,
      amount: 100_000,
      owedBefore: 100_000,
      owedAfter: 0,
      source: 'ORDER_CREATE',
      reversedOn: null,
    });

    await http().post(`/api/orders/${order.id}/cancel`).set(asUser(admin)).send({ version: 1 }).expect(200);
    expect(await receiptOf(automatic.id)).toMatchObject({ reversedOn: TODAY });
  });

  it('a refund prints the return’s credit, what was owed before it, and the cash paid out', async () => {
    const order = await order100('LENT');
    await recordPayment(app, admin, { orderId: order.id, amount: 90_000, date: '2026-09-05' });
    const returnId = await recordReturn(app, admin, {
      orderId: order.id,
      date: '2026-09-10',
      lines: [{ orderLineId: order.lines[0]?.id ?? 0, acceptedQuantity: 25 }],
    });
    const refund = await prisma.ledgerEntry.findFirstOrThrow({ where: { returnId, type: 'REFUND' } });

    expect(await receiptOf(refund.id)).toMatchObject({
      kind: 'REFUND',
      date: '2026-09-10',
      amount: 15_000,
      owedBefore: 10_000,
      credit: 25_000,
      owedAfter: 0,
      reversedOn: null,
    });

    await http().delete(`/api/returns/${returnId}`).set(asUser(admin)).expect(200);
    expect(await receiptOf(refund.id)).toMatchObject({ amount: 15_000, reversedOn: TODAY });
  });

  it('a reversal row has no receipt of its own, and an unknown row is not found', async () => {
    const order = await order100('LENT');
    const paid = await recordPayment(app, admin, { orderId: order.id, amount: 5_000, date: TODAY });
    const reversed = (await http().post(`/api/ledger-entries/${paid}/reverse`).set(asUser(admin)).send({}).expect(200))
      .body as { ledgerEntryId: number };

    expect((await receipt(reversed.ledgerEntryId).expect(409)).body).toMatchObject({
      error: { code: 'LEDGER_ENTRY_NO_RECEIPT', details: { type: 'PAYMENT_REVERSAL' } },
    });
    expect((await receipt(999_999).expect(404)).body).toMatchObject({
      error: { code: 'LEDGER_ENTRY_NOT_FOUND' },
    });
  });

  it('needs orders.view', async () => {
    const order = await order100('LENT');
    const paid = await recordPayment(app, admin, { orderId: order.id, amount: 5_000, date: TODAY });
    const blind = await createEmployee(app, [], 'blind');
    const viewer = await createEmployee(app, ['orders.view'], 'viewer');

    await receipt(paid, await login(app, blind.username, EMPLOYEE_PASSWORD)).expect(403);
    await receipt(paid, await login(app, viewer.username, EMPLOYEE_PASSWORD)).expect(200);
  });
});
