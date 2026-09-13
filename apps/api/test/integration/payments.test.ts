import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { CustomerDto, DriverDto, ItemDto, OrderDetailDto, PaymentResultDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import {
  EMPLOYEE_PASSWORD,
  createCustomer,
  createDriver,
  createEmployee,
  createItem,
  createOrder,
} from '../helpers/factories';

/** "today = 2026-09-11" of the worked examples (§4.10), midday in Baghdad. */
const NOW = new Date('2026-09-11T09:00:00Z');
const TODAY = '2026-09-11';

describe('payments and their reversal (§4.8.7, §4.8.8, §6.21)', () => {
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
  const order100 = (paymentType: 'CASH' | 'LENT', date = TODAY): Promise<OrderDetailDto> =>
    createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date,
      paymentType,
      lines: [{ itemId: item.id, quantity: 100 }],
    });
  const pay = (
    orderId: number,
    body: Record<string, unknown>,
    options: { session?: Session; key?: string } = {},
  ): request.Test =>
    http()
      .post(`/api/orders/${orderId}/payments`)
      .set(asUser(options.session ?? admin))
      .set('Idempotency-Key', options.key ?? randomUUID())
      .send({ date: TODAY, ...body });
  const reverse = (entryId: number, body: Record<string, unknown> = {}, session: Session = admin): request.Test =>
    http().post(`/api/ledger-entries/${entryId}/reverse`).set(asUser(session)).send(body);

  it('E5 — a manual payment lowers what a credit order owes and is held against the pallets out', async () => {
    const order = await order100('LENT');

    const paid = (await pay(order.id, { amount: 40_000, note: 'Cash at the gate' }).expect(201))
      .body as PaymentResultDto;

    expect(paid.order).toMatchObject({
      paymentsNet: 40_000,
      owed: 60_000,
      outValue: 100_000,
      held: 40_000,
      version: 2,
    });
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paid.ledgerEntryId } });
    expect(entry).toMatchObject({
      type: 'PAYMENT',
      source: 'MANUAL',
      isAutomatic: false,
      amount: 40_000n,
      date: new Date(`${TODAY}T00:00:00.000Z`),
      note: 'Cash at the gate',
    });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'PAYMENT_CREATE' } });
    expect(audit).toMatchObject({
      entityType: 'LEDGER_ENTRY',
      entityId: String(paid.ledgerEntryId),
      summaryParams: { orderNumber: order.orderNumber, amount: 40_000, automatic: false },
    });
    // A manual payment is activity: the lines are frozen and the order cannot be cancelled.
    expect(paid.order.canEditLines).toBe(false);
  });

  it('I12 — refuses a payment above what is owed, on a cash order, dated before the order or after today', async () => {
    const lent = await order100('LENT', '2026-09-10');
    const cash = await order100('CASH');

    const over = await pay(lent.id, { amount: 100_001 }).expect(409);
    expect(over.body).toMatchObject({
      error: { code: 'PAYMENT_EXCEEDS_OWED', details: { owed: 100_000, amount: 100_001 } },
    });
    await pay(lent.id, { amount: 100_000 }).expect(201);
    const settled = await pay(lent.id, { amount: 1 }).expect(409);
    expect(settled.body).toMatchObject({ error: { code: 'PAYMENT_EXCEEDS_OWED', details: { owed: 0 } } });

    const onCash = await pay(cash.id, { amount: 1_000 }).expect(409);
    expect(onCash.body).toMatchObject({ error: { code: 'PAYMENT_ORDER_NOT_LENT', details: { paymentType: 'CASH' } } });

    const other = await order100('LENT', '2026-09-10');
    const early = await pay(other.id, { amount: 1_000, date: '2026-09-09' }).expect(400);
    expect(early.body).toMatchObject({
      error: { code: 'PAYMENT_DATE_BEFORE_ORDER_DATE', details: { orderDate: '2026-09-10' } },
    });
    const future = await pay(other.id, { amount: 1_000, date: '2026-09-12' }).expect(400);
    expect(future.body).toMatchObject({ error: { code: 'BUSINESS_DATE_IN_FUTURE' } });
    await pay(other.id, { amount: 0 }).expect(400);
    const missing = await pay(999_999, { amount: 1_000 }).expect(404);
    expect(missing.body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND' } });

    await http().post(`/api/orders/${other.id}/cancel`).set(asUser(admin)).send({ version: 1 }).expect(200);
    const cancelled = await pay(other.id, { amount: 1_000 }).expect(409);
    expect(cancelled.body).toMatchObject({ error: { code: 'ORDER_CANCELLED' } });
  });

  it('I12 — reversing a manual payment adds its amount back; nothing else is reversible, and nothing twice', async () => {
    const lent = await order100('LENT');
    const paid = (await pay(lent.id, { amount: 40_000 }).expect(201)).body as PaymentResultDto;

    const reversed = (await reverse(paid.ledgerEntryId, { note: 'Recorded on the wrong order' }).expect(200))
      .body as PaymentResultDto;

    expect(reversed.ledgerEntryId).not.toBe(paid.ledgerEntryId);
    expect(reversed.order).toMatchObject({ paymentsNet: 0, owed: 100_000, held: 0, canEditLines: true, version: 3 });
    expect(await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: reversed.ledgerEntryId } })).toMatchObject({
      type: 'PAYMENT_REVERSAL',
      source: 'PAYMENT_DELETE',
      amount: 40_000n,
      date: new Date(`${TODAY}T00:00:00.000Z`),
      reversesEntryId: paid.ledgerEntryId,
      note: 'Recorded on the wrong order',
    });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'PAYMENT_REVERSE' } });
    expect(audit).toMatchObject({
      entityId: String(reversed.ledgerEntryId),
      summaryParams: { orderNumber: lent.orderNumber, amount: 40_000 },
    });

    const twice = await reverse(paid.ledgerEntryId).expect(409);
    expect(twice.body).toMatchObject({
      error: { code: 'LEDGER_ENTRY_ALREADY_REVERSED', details: { ledgerEntryId: paid.ledgerEntryId } },
    });

    const cash = await order100('CASH');
    const automatic = cash.ledgerEntries[0]?.id ?? 0;
    const refused = await reverse(automatic).expect(409);
    expect(refused.body).toMatchObject({
      error: { code: 'LEDGER_ENTRY_NOT_REVERSIBLE', details: { type: 'PAYMENT', source: 'ORDER_CREATE' } },
    });
    const missing = await reverse(999_999).expect(404);
    expect(missing.body).toMatchObject({
      error: { code: 'LEDGER_ENTRY_NOT_FOUND', details: { ledgerEntryId: 999_999 } },
    });
  });

  it('records one payment per idempotency key, and only a permitted user pays or reverses', async () => {
    const lent = await order100('LENT');
    const key = randomUUID();

    const first = await pay(lent.id, { amount: 10_000 }, { key }).expect(201);
    const replay = await pay(lent.id, { amount: 10_000 }, { key }).expect(201);

    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await prisma.ledgerEntry.count({ where: { orderId: lent.id } })).toBe(1);
    await pay(lent.id, { amount: 10_001 }, { key }).expect(409);

    const clerkUser = await createEmployee(app, ['orders.view', 'payments.create'], 'clerk');
    const clerk = await login(app, clerkUser.username, EMPLOYEE_PASSWORD);
    await pay(lent.id, { amount: 1_000 }, { session: clerk }).expect(201);
    await reverse((first.body as PaymentResultDto).ledgerEntryId, {}, clerk).expect(403);
  });

  it('I8 — a return and a payment racing on one order never leave it owing below zero', async () => {
    const lent = await order100('LENT');
    const line = lent.lines[0]?.id ?? 0;

    const [returned, paid] = await Promise.all([
      http()
        .post(`/api/orders/${lent.id}/returns`)
        .set(asUser(admin))
        .set('Idempotency-Key', randomUUID())
        .send({ date: TODAY, lines: [{ orderLineId: line, acceptedQuantity: 60, damagedQuantity: 0 }] }),
      pay(lent.id, { amount: 70_000 }),
    ]);

    // Each is judged on the owed the other left. Return first: 40,000 owed, so the 70,000 payment is
    // refused. Payment first: 30,000 owed, so the return credits 60,000 and pays 30,000 back in cash.
    expect(returned.status).toBe(201);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: lent.id } });
    if (paid.status === 201) {
      expect([stored.owed, stored.refundsNet]).toEqual([0n, 30_000n]);
    } else {
      expect(paid.body).toMatchObject({ error: { code: 'PAYMENT_EXCEEDS_OWED', details: { owed: 40_000 } } });
      expect(stored.owed).toBe(40_000n);
    }
  });
});
