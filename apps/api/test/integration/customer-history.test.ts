import type { INestApplication } from '@nestjs/common';
import type { CustomerDto, CustomerHistoryItemDto, DriverDto, ItemDto, PageDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
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
  recordPayment,
  recordReturn,
} from '../helpers/factories';

const NOW = new Date('2026-09-12T09:00:00Z');

/** §6.17: a customer's timeline of hand-overs, returns and money rows, newest first. */
describe('customer history (§6.17)', () => {
  let app: INestApplication;
  let admin: Session;
  let item: ItemDto;
  let customer: CustomerDto;
  let driver: DriverDto;
  let ids: { lent: number; cash: number; cancelled: number; payment: number; kept: number; deleted: number };

  beforeAll(async () => {
    app = await createTestApp({ clock: new FixedClock(NOW) });
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    admin = await login(app);
    item = await createItem(app, admin, { name: 'Euro pallet', depositPrice: 1_000, stock: 500 });
    customer = await createCustomer(app, admin);
    driver = await createDriver(app, admin);
    const other = await createCustomer(app, admin, { name: 'Other Co', phone: '07509999999' });

    const order = (customerId: number, date: string, paymentType: 'CASH' | 'LENT', quantity: number) =>
      createOrder(app, admin, {
        customerId,
        driverId: driver.id,
        date,
        paymentType,
        lines: [{ itemId: item.id, quantity }],
      });
    const lent = await order(customer.id, '2026-09-05', 'LENT', 20);
    const cash = await order(customer.id, '2026-09-06', 'CASH', 10);
    const payment = await recordPayment(app, admin, { orderId: lent.id, amount: 5_000, date: '2026-09-07' });
    const line = lent.lines[0]?.id ?? 0;
    const kept = await recordReturn(app, admin, {
      orderId: lent.id,
      date: '2026-09-08',
      lines: [{ orderLineId: line, acceptedQuantity: 5, damagedQuantity: 1 }],
    });
    const deleted = await recordReturn(app, admin, {
      orderId: lent.id,
      date: '2026-09-09',
      lines: [{ orderLineId: line, acceptedQuantity: 2 }],
    });
    await request(app.getHttpServer()).delete(`/api/returns/${deleted}`).set(asUser(admin)).expect(200);
    const cancelled = await order(customer.id, '2026-09-10', 'LENT', 3);
    await request(app.getHttpServer())
      .post(`/api/orders/${cancelled.id}/cancel`)
      .set(asUser(admin))
      .send({ version: 1 })
      .expect(200);
    await order(other.id, '2026-09-11', 'LENT', 4);
    ids = { lent: lent.id, cash: cash.id, cancelled: cancelled.id, payment, kept, deleted };
  });

  const history = async (query = '', session: Session = admin): Promise<PageDto<CustomerHistoryItemDto>> =>
    (
      await request(app.getHttpServer())
        .get(`/api/customers/${customer.id}/history${query}`)
        .set(asUser(session))
        .expect(200)
    ).body as PageDto<CustomerHistoryItemDto>;
  const labels = (page: PageDto<CustomerHistoryItemDto>): string[] =>
    page.items.map((entry) => `${entry.date} ${entry.kind}${entry.kind === 'LEDGER' ? ` ${entry.type}` : ''}`);

  it('lists hand-overs, returns and money rows by date, newest first, leaving cancelled orders out', async () => {
    const page = await history();

    expect(labels(page)).toEqual([
      '2026-09-09 RETURN',
      '2026-09-08 RETURN',
      '2026-09-07 LEDGER PAYMENT',
      // Same day: a hand-over and its automatic payment, recorded in one transaction. Their order
      // rests on created_at, which two inserts may share to the millisecond, so only the pair is fixed.
      expect.stringMatching(/^2026-09-06 /),
      expect.stringMatching(/^2026-09-06 /),
      '2026-09-05 HANDOVER',
    ]);
    expect(labels(page).slice(3, 5).sort()).toEqual(['2026-09-06 HANDOVER', '2026-09-06 LEDGER PAYMENT']);
    expect(page.total).toBe(6);

    const [deleted, kept, payment, , , lent] = page.items;
    const sameDay = page.items.slice(3, 5);
    const cash = sameDay.find((entry) => entry.kind === 'HANDOVER');
    const automatic = sameDay.find((entry) => entry.kind === 'LEDGER');
    expect(deleted).toMatchObject({
      kind: 'RETURN',
      returnId: ids.deleted,
      reversed: true,
      reversalKind: 'DELETE',
      acceptedTotal: 2,
    });
    expect(kept).toEqual({
      kind: 'RETURN',
      date: '2026-09-08',
      createdAt: expect.any(String),
      returnId: ids.kept,
      orderId: ids.lent,
      orderNumber: 1,
      reversed: false,
      reversalKind: null,
      replacedByReturnId: null,
      lines: [
        {
          item: { id: item.id, name: 'Euro pallet', imageUrl: null, archived: false },
          acceptedQuantity: 5,
          damagedQuantity: 1,
          damagedRefund: 0,
        },
      ],
      acceptedTotal: 5,
      damagedTotal: 1,
      refundDue: 5_000,
      cashRefund: 0,
    });
    expect(payment).toMatchObject({
      kind: 'LEDGER',
      ledgerEntryId: ids.payment,
      orderId: ids.lent,
      source: 'MANUAL',
      amount: 5_000,
      isAutomatic: false,
      reversesEntryId: null,
      note: null,
    });
    expect(cash).toMatchObject({
      kind: 'HANDOVER',
      orderId: ids.cash,
      paymentType: 'CASH',
      quantityTotal: 10,
      depositTotal: 10_000,
    });
    expect(automatic).toMatchObject({
      kind: 'LEDGER',
      orderId: ids.cash,
      source: 'ORDER_CREATE',
      isAutomatic: true,
      amount: 10_000,
    });
    expect(lent).toEqual({
      kind: 'HANDOVER',
      date: '2026-09-05',
      createdAt: expect.any(String),
      orderId: ids.lent,
      orderNumber: 1,
      paymentType: 'LENT',
      status: 'OPEN',
      cancelled: false,
      driver: { id: driver.id, name: driver.name, phone: driver.phone, carNumber: driver.carNumber, archived: false },
      lines: [
        {
          item: { id: item.id, name: 'Euro pallet', imageUrl: null, archived: false },
          quantity: 20,
          unitDeposit: 1_000,
          lineTotal: 20_000,
        },
      ],
      quantityTotal: 20,
      depositTotal: 20_000,
    });
  });

  it('filters by kind, by date and by cancelled orders, and pages', async () => {
    expect(labels(await history('?kinds=LEDGER'))).toEqual(['2026-09-07 LEDGER PAYMENT', '2026-09-06 LEDGER PAYMENT']);
    expect(labels(await history('?kinds=HANDOVER,RETURN&dateFrom=2026-09-06&dateTo=2026-09-08'))).toEqual([
      '2026-09-08 RETURN',
      '2026-09-06 HANDOVER',
    ]);
    const withCancelled = await history('?includeCancelled=true');
    expect(labels(withCancelled)[0]).toBe('2026-09-10 HANDOVER');
    expect(withCancelled.items[0]).toMatchObject({ orderId: ids.cancelled, cancelled: true, status: 'CANCELLED' });

    const second = await history('?pageSize=2&page=2');
    expect(labels(second)).toEqual(['2026-09-07 LEDGER PAYMENT', expect.stringMatching(/^2026-09-06 /)]);
    expect(second).toMatchObject({ page: 2, pageSize: 2, total: 6 });
  });

  it('refuses an unknown kind, a reversed range and a missing customer, and needs customers and orders access', async () => {
    const http = request(app.getHttpServer());
    const unknown = await http
      .get(`/api/customers/${customer.id}/history?kinds=HANDOVER,GIFT`)
      .set(asUser(admin))
      .expect(400);
    expect(unknown.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', fields: [{ code: 'invalid_enum' }] } });
    const range = await request(app.getHttpServer())
      .get(`/api/customers/${customer.id}/history?dateFrom=2026-09-10&dateTo=2026-09-01`)
      .set(asUser(admin))
      .expect(400);
    expect(range.body).toMatchObject({ error: { code: 'DATE_RANGE_INVALID' } });
    const missing = await request(app.getHttpServer())
      .get('/api/customers/999999/history')
      .set(asUser(admin))
      .expect(404);
    expect(missing.body).toMatchObject({ error: { code: 'CUSTOMER_NOT_FOUND' } });

    const viewer = await createEmployee(app, ['customers.view'], 'viewer');
    const session = await login(app, viewer.username, EMPLOYEE_PASSWORD);
    await request(app.getHttpServer()).get(`/api/customers/${customer.id}/history`).set(asUser(session)).expect(403);
  });
});
