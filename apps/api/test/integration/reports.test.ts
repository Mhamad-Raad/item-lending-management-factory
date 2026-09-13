import { randomUUID } from 'node:crypto';
import type {
  ActivityReportDto,
  CustomerDto,
  DashboardDto,
  DriverDto,
  ItemDto,
  OrderDetailDto,
  PositionsReportDto,
  PurchasesReportDto,
  StockReportDto,
} from '@pallet/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import {
  EMPLOYEE_PASSWORD,
  createCustomer,
  createDriver,
  createItem,
  createOrder,
  createUser,
  recordPayment,
  recordReturn,
} from '../helpers/factories';

const NOW = new Date('2026-09-12T09:00:00Z');
const TODAY = '2026-09-12';

/**
 * Reports and dashboard (§6.22, §6.23, §12) over one hand-computed scenario. Every figure below is worked
 * out by hand from these operations, not read back from the code:
 *
 * - Pallet A (1,000; 500 bought 09-01 at 700; 50 more 09-03 at 800; 10 more 09-04, deleted),
 *   Pallet B (2,500; 100 bought 09-01 at 700; minimum stock 90).
 * - O1 LENT Ashti, driver Dilan, 09-01, A × 100; paid 40,000 on 09-03; 50 A back on 09-05 (§12.4's example).
 * - O2 CASH Baban, driver Hemin, 09-02, A × 20 + B × 10 = 45,000; on 09-04 5 A back and 2 B damaged
 *   with 1,000 refunded: refund due 6,000, all paid out; compensation 2 × 2,500 − 1,000 = 4,000.
 * - O3 LENT Ashti, 09-02, A × 30, cancelled: in no aggregate.
 * - O4 LENT Baban, Dilan, 09-03, A × 10; 10 back on 09-04, then that return deleted; paid 5,000 on
 *   09-04, then that payment reversed (the reversal dated today, 09-12).
 */
interface Scenario {
  admin: Session;
  a: ItemDto;
  b: ItemDto;
  ashti: CustomerDto;
  baban: CustomerDto;
  dilan: DriverDto;
  hemin: DriverDto;
  orders: Record<'o1' | 'o2' | 'o3' | 'o4', OrderDetailDto>;
}

/** Builds the scenario described above, through the API. */
async function seed(app: INestApplication): Promise<Scenario> {
  await resetDatabase();
  const admin = await login(app);
  const orders = {} as Scenario['orders'];
  const http = () => request(app.getHttpServer());

  const a = await createItem(app, admin, { name: 'Pallet A', depositPrice: 1_000, stock: 500 });
  const b = await createItem(app, admin, { name: 'Pallet B', depositPrice: 2_500, stock: 100, minStock: 90 });
  await http()
    .post('/api/purchase-batches')
    .set(asUser(admin))
    .send({ itemId: a.id, date: '2026-09-03', quantity: 50, unitCost: 800 })
    .expect(201);
  const deleted = await http()
    .post('/api/purchase-batches')
    .set(asUser(admin))
    .send({ itemId: a.id, date: '2026-09-04', quantity: 10, unitCost: 900 })
    .expect(201);
  await http().delete(`/api/purchase-batches/${deleted.body.id}?version=1`).set(asUser(admin)).expect(204);

  const ashti = await createCustomer(app, admin, { name: 'Ashti Blocks', phone: '07501111111' });
  const baban = await createCustomer(app, admin, { name: 'Baban Cement', phone: '07502222222' });
  const dilan = await createDriver(app, admin);
  const hemin = (
    await http()
      .post('/api/drivers')
      .set(asUser(admin))
      .send({ name: 'Hemin Ali', phone: '07703334444', carNumber: 'Erbil 22 B 11111' })
      .expect(201)
  ).body as DriverDto;

  const order = (
    customerId: number,
    driverId: number,
    date: string,
    paymentType: 'CASH' | 'LENT',
    lines: { itemId: number; quantity: number }[],
  ) => createOrder(app, admin, { customerId, driverId, date, paymentType, lines });
  orders.o1 = await order(ashti.id, dilan.id, '2026-09-01', 'LENT', [{ itemId: a.id, quantity: 100 }]);
  orders.o2 = await order(baban.id, hemin.id, '2026-09-02', 'CASH', [
    { itemId: a.id, quantity: 20 },
    { itemId: b.id, quantity: 10 },
  ]);
  orders.o3 = await order(ashti.id, dilan.id, '2026-09-02', 'LENT', [{ itemId: a.id, quantity: 30 }]);
  orders.o4 = await order(baban.id, dilan.id, '2026-09-03', 'LENT', [{ itemId: a.id, quantity: 10 }]);

  await recordPayment(app, admin, { orderId: orders.o1.id, amount: 40_000, date: '2026-09-03' });
  const lineOf = (detail: OrderDetailDto, itemId: number) =>
    detail.lines.find((line) => line.item.id === itemId)?.id ?? 0;
  await http()
    .post(`/api/orders/${orders.o2.id}/returns`)
    .set(asUser(admin))
    .set('Idempotency-Key', randomUUID())
    .send({
      date: '2026-09-04',
      lines: [
        { orderLineId: lineOf(orders.o2, a.id), acceptedQuantity: 5, damagedQuantity: 0 },
        { orderLineId: lineOf(orders.o2, b.id), acceptedQuantity: 0, damagedQuantity: 2, damagedRefund: 1_000 },
      ],
    })
    .expect(201);
  await http().post(`/api/orders/${orders.o3.id}/cancel`).set(asUser(admin)).send({ version: 1 }).expect(200);
  const o4Return = await recordReturn(app, admin, {
    orderId: orders.o4.id,
    date: '2026-09-04',
    lines: [{ orderLineId: lineOf(orders.o4, a.id), acceptedQuantity: 10 }],
  });
  await http().delete(`/api/returns/${o4Return}`).set(asUser(admin)).expect(200);
  const o4Payment = await recordPayment(app, admin, { orderId: orders.o4.id, amount: 5_000, date: '2026-09-04' });
  await http().post(`/api/ledger-entries/${o4Payment}/reverse`).set(asUser(admin)).send({}).expect(200);
  await recordReturn(app, admin, {
    orderId: orders.o1.id,
    date: '2026-09-05',
    lines: [{ orderLineId: lineOf(orders.o1, a.id), acceptedQuantity: 50 }],
  });
  return { admin, a, b, ashti, baban, dilan, hemin, orders };
}

describe('reports and dashboard (§6.22, §6.23, §12)', () => {
  let app: INestApplication;
  let admin: Session;
  let a: ItemDto;
  let b: ItemDto;
  let ashti: CustomerDto;
  let baban: CustomerDto;
  let hemin: DriverDto;
  let orders: Scenario['orders'];

  beforeAll(async () => {
    app = await createTestApp({ clock: new FixedClock(NOW) });
    ({ admin, a, b, ashti, baban, hemin, orders } = await seed(app));
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  const get = async <T>(path: string, session: Session = admin): Promise<T> =>
    (await request(app.getHttpServer()).get(path).set(asUser(session)).expect(200)).body as T;
  const ref = (item: ItemDto) => ({ id: item.id, name: item.name, imageUrl: null, archived: false });

  it('positions: what each customer holds and owes, without the cancelled order', async () => {
    const report = await get<PositionsReportDto>('/api/reports/positions');

    expect(report.generatedAt).toBe(NOW.toISOString());
    expect(report.columns).toEqual([ref(a), ref(b)]);
    // Owed ties at 10,000; the name decides.
    expect(report.rows).toEqual([
      {
        customer: { id: ashti.id, name: 'Ashti Blocks', phone: '07501111111', archived: false },
        palletsOutByItem: [
          { itemId: a.id, quantityOut: 50 },
          { itemId: b.id, quantityOut: 0 },
        ],
        palletsOut: 50,
        outValue: 50_000,
        owed: 10_000,
        held: 40_000,
      },
      {
        customer: { id: baban.id, name: 'Baban Cement', phone: '07502222222', archived: false },
        palletsOutByItem: [
          { itemId: a.id, quantityOut: 25 },
          { itemId: b.id, quantityOut: 8 },
        ],
        palletsOut: 33,
        outValue: 45_000,
        owed: 10_000,
        held: 35_000,
      },
    ]);
    expect(report.totals).toEqual({
      palletsOutByItem: [
        { itemId: a.id, quantityOut: 75 },
        { itemId: b.id, quantityOut: 8 },
      ],
      palletsOut: 83,
      outValue: 95_000,
      owed: 20_000,
      held: 75_000,
    });

    const one = await get<PositionsReportDto>(`/api/reports/positions?customerId=${baban.id}&sort=-palletsOut`);
    expect(one.rows.map((row) => row.customer.name)).toEqual(['Baban Cement']);
    expect(one.totals.palletsOut).toBe(33);
    const sorted = await get<PositionsReportDto>('/api/reports/positions?sort=-held');
    expect(sorted.rows.map((row) => row.held)).toEqual([40_000, 35_000]);

    // Names are not unique: equal figures and equal names fall back to the customer's id, every time.
    const twins = await Promise.all(
      ['07509990001', '07509990002'].map((phone) => createCustomer(app, admin, { name: 'Twin Traders', phone })),
    );
    const withZero = await get<PositionsReportDto>('/api/reports/positions?includeZero=true&sort=customerName');
    expect(withZero.rows.filter((row) => row.customer.name === 'Twin Traders').map((row) => row.customer.id)).toEqual(
      twins.map((twin) => twin.id).sort((x, y) => x - y),
    );
    const reversedSort = await get<PositionsReportDto>('/api/reports/positions?includeZero=true&sort=-customerName');
    expect(
      reversedSort.rows.filter((row) => row.customer.name === 'Twin Traders').map((row) => row.customer.id),
    ).toEqual(twins.map((twin) => twin.id).sort((x, y) => x - y));
  });

  it('purchases: each standing batch in the period, per item and in total, never averaged', async () => {
    const report = await get<PurchasesReportDto>('/api/reports/purchases?dateFrom=2026-09-01&dateTo=2026-09-05');

    expect(report).toMatchObject({
      dateFrom: '2026-09-01',
      dateTo: '2026-09-05',
      truncated: false,
      generatedAt: NOW.toISOString(),
    });
    expect(
      report.rows.map(({ item, date, quantity, unitCost, totalCost }) => [
        item.name,
        date,
        quantity,
        unitCost,
        totalCost,
      ]),
    ).toEqual([
      ['Pallet A', '2026-09-01', 500, 700, 350_000],
      ['Pallet B', '2026-09-01', 100, 700, 70_000],
      ['Pallet A', '2026-09-03', 50, 800, 40_000],
    ]);
    expect(report.perItem).toEqual([
      { item: ref(a), batchCount: 2, quantity: 550, totalCost: 390_000 },
      { item: ref(b), batchCount: 1, quantity: 100, totalCost: 70_000 },
    ]);
    expect(report.totals).toEqual({ batchCount: 3, quantity: 650, totalCost: 460_000 });

    const onlyB = await get<PurchasesReportDto>(
      `/api/reports/purchases?dateFrom=2026-09-01&dateTo=2026-09-05&itemId=${b.id}`,
    );
    expect(onlyB.totals).toEqual({ batchCount: 1, quantity: 100, totalCost: 70_000 });
  });

  it('activity: hand-overs, returns, money and compensation in the period, with nothing reversed or cancelled', async () => {
    const report = await get<ActivityReportDto>('/api/reports/activity?dateFrom=2026-09-01&dateTo=2026-09-05');

    expect(report).toMatchObject({
      moneyOmitted: false,
      truncated: false,
      filters: { customerId: null, itemId: null, driverId: null },
    });
    expect(report.handovers.map((row) => [row.orderNumber, row.date, row.quantity, row.depositTotal])).toEqual([
      [orders.o1.orderNumber, '2026-09-01', 100, 100_000],
      [orders.o2.orderNumber, '2026-09-02', 30, 45_000],
      [orders.o4.orderNumber, '2026-09-03', 10, 10_000],
    ]);
    expect(report.handovers[1]?.driver.name).toBe('Hemin Ali');
    expect(
      report.returns.map((row) => [
        row.orderNumber,
        row.date,
        row.acceptedQuantity,
        row.damagedQuantity,
        row.refundDue,
        row.cashRefund,
      ]),
    ).toEqual([
      [orders.o2.orderNumber, '2026-09-04', 5, 2, 6_000, 6_000],
      [orders.o1.orderNumber, '2026-09-05', 50, 0, 50_000, 0],
    ]);
    expect(
      report.payments.map((row) => [row.orderNumber, row.effectiveDate, row.type, row.source, row.amount]),
    ).toEqual([
      [orders.o2.orderNumber, '2026-09-02', 'PAYMENT', 'ORDER_CREATE', 45_000],
      [orders.o1.orderNumber, '2026-09-03', 'PAYMENT', 'MANUAL', 40_000],
      [orders.o4.orderNumber, '2026-09-04', 'PAYMENT', 'MANUAL', 5_000],
    ]);
    expect(report.refunds.map((row) => [row.orderNumber, row.type, row.amount])).toEqual([
      [orders.o2.orderNumber, 'REFUND', 6_000],
    ]);
    expect(report.compensation).toEqual([
      {
        returnId: expect.any(Number),
        orderNumber: orders.o2.orderNumber,
        date: '2026-09-04',
        customer: expect.objectContaining({ id: baban.id }),
        item: ref(b),
        damagedQuantity: 2,
        unitDeposit: 2_500,
        damagedRefund: 1_000,
        compensation: 4_000,
      },
    ]);
    expect(report.totals).toEqual({
      handoverQuantity: 140,
      handoverDepositTotal: 155_000,
      returnedAccepted: 55,
      returnedDamaged: 2,
      refundDueTotal: 56_000,
      paymentsGross: 90_000,
      paymentReversals: 0,
      paymentsNet: 90_000,
      refundsGross: 6_000,
      refundReversals: 0,
      refundsNet: 6_000,
      compensationAssessed: 4_000,
    });

    // To today, the payment's reversal falls in the period: listed as its own row, netted in the totals only.
    const toToday = await get<ActivityReportDto>(`/api/reports/activity?dateFrom=2026-09-01&dateTo=${TODAY}`);
    expect(toToday.payments.at(-1)).toMatchObject({ type: 'PAYMENT_REVERSAL', amount: 5_000, effectiveDate: TODAY });
    expect(toToday.totals).toMatchObject({ paymentsGross: 90_000, paymentReversals: 5_000, paymentsNet: 85_000 });
  });

  it('activity filters: a customer or a driver through the order; an item leaves the money out', async () => {
    const range = 'dateFrom=2026-09-01&dateTo=2026-09-05';
    const ofAshti = await get<ActivityReportDto>(`/api/reports/activity?${range}&customerId=${ashti.id}`);
    expect(ofAshti.handovers.map((row) => row.orderNumber)).toEqual([orders.o1.orderNumber]);
    expect(ofAshti.totals).toMatchObject({
      handoverQuantity: 100,
      returnedAccepted: 50,
      paymentsNet: 40_000,
      refundsNet: 0,
    });

    const ofHemin = await get<ActivityReportDto>(`/api/reports/activity?${range}&driverId=${hemin.id}`);
    expect(ofHemin.handovers.map((row) => row.orderNumber)).toEqual([orders.o2.orderNumber]);
    expect(ofHemin.totals).toMatchObject({ paymentsNet: 45_000, refundsNet: 6_000 });

    const ofB = await get<ActivityReportDto>(`/api/reports/activity?${range}&itemId=${b.id}`);
    expect(ofB).toMatchObject({ moneyOmitted: true, payments: [], refunds: [], filters: { itemId: b.id } });
    expect(ofB.handovers).toEqual([
      expect.objectContaining({ orderNumber: orders.o2.orderNumber, quantity: 10, depositTotal: 25_000 }),
    ]);
    expect(ofB.handovers[0]?.lines.map((line) => line.item.id)).toEqual([b.id]);
    // Money belongs to the whole order: the return's cash refund is not split by item.
    expect(ofB.returns[0]).toMatchObject({ acceptedQuantity: 0, damagedQuantity: 2, refundDue: 1_000, cashRefund: 0 });
    expect(ofB.totals).toMatchObject({
      handoverQuantity: 10,
      handoverDepositTotal: 25_000,
      paymentsGross: 0,
      refundsGross: 0,
      compensationAssessed: 4_000,
    });
  });

  it('stock: on hand, out with customers and damaged per item, with the low-stock flag', async () => {
    const report = await get<StockReportDto>('/api/reports/stock');

    // A: 500 + 50 bought, 100 + 20 + 10 out, 50 + 5 back (the cancelled and the deleted return net to 0).
    expect(report.rows).toEqual([
      { item: ref(a), quantityOnHand: 475, quantityOut: 75, damagedTotal: 0, minStock: null, isLowStock: false },
      { item: ref(b), quantityOnHand: 90, quantityOut: 8, damagedTotal: 2, minStock: 90, isLowStock: true },
    ]);
    expect(report.totals).toEqual({ quantityOnHand: 565, quantityOut: 83, damagedTotal: 2, lowStockCount: 1 });
    expect((await get<StockReportDto>('/api/reports/stock?lowStockOnly=true')).rows.map((row) => row.item.id)).toEqual([
      b.id,
    ]);
    expect((await get<StockReportDto>('/api/reports/stock?sort=-quantityOut')).rows.map((row) => row.item.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it('refuses a reversed or future period, and the purchases report to a viewer without cost', async () => {
    const http = () => request(app.getHttpServer());
    const reversed = await http()
      .get('/api/reports/activity?dateFrom=2026-09-05&dateTo=2026-09-01')
      .set(asUser(admin))
      .expect(400);
    expect(reversed.body).toMatchObject({ error: { code: 'DATE_RANGE_INVALID' } });
    const future = await http()
      .get('/api/reports/purchases?dateFrom=2026-09-01&dateTo=2026-09-13')
      .set(asUser(admin))
      .expect(400);
    expect(future.body).toMatchObject({ error: { code: 'BUSINESS_DATE_IN_FUTURE' } });
    await http().get('/api/reports/activity?dateFrom=2026-09-01').set(asUser(admin)).expect(400);

    // Written straight to the table: the API would refuse the grant without its dependency.
    const noCost = await createUser(app, { username: 'nocost', permissions: ['reports.viewPurchases'] });
    const session = await login(app, noCost.username, EMPLOYEE_PASSWORD);
    const refused = await http()
      .get('/api/reports/purchases?dateFrom=2026-09-01&dateTo=2026-09-05')
      .set(asUser(session))
      .expect(403);
    expect(refused.body).toMatchObject({
      error: { code: 'PERMISSION_DENIED', details: { required: ['items.viewCost'] } },
    });
  });
});

/**
 * The dashboard over the same scenario, on the system clock: its activity is ordered by when each event
 * was recorded, and a cancellation's time comes from the application clock while every other row's
 * comes from the database — a fixed test clock would put the cancellation days away from the rest.
 */
describe('dashboard (§6.22)', () => {
  let app: INestApplication;
  let admin: Session;
  let b: ItemDto;
  let orders: Scenario['orders'];

  beforeAll(async () => {
    app = await createTestApp();
    ({ admin, b, orders } = await seed(app));
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  const get = async <T>(path: string, session: Session = admin): Promise<T> =>
    (await request(app.getHttpServer()).get(path).set(asUser(session)).expect(200)).body as T;

  it('dashboard: the sections each viewer may see, from the same figures', async () => {
    const full = await get<DashboardDto>('/api/dashboard');
    expect(full.positions).toEqual({
      palletsOut: 83,
      outValue: 95_000,
      owed: 20_000,
      held: 75_000,
      openOrderCount: 3,
      customersWithOpenOrders: 2,
    });
    expect(full.lowStock).toEqual({
      count: 1,
      items: [{ id: b.id, name: 'Pallet B', imageUrl: null, quantityOnHand: 90, minStock: 90 }],
    });
    const activity = full.recentActivity ?? [];
    expect(activity).toHaveLength(10);
    // Hand-overs 4, cancellation 1, returns 3, manual payments 2, refund 1: eleven, the oldest drops.
    expect(activity.filter((event) => event.kind === 'PAYMENT')).toEqual(
      expect.arrayContaining([expect.objectContaining({ orderId: orders.o4.id, amount: 5_000, reversed: true })]),
    );
    expect(activity.filter((event) => event.kind === 'RETURN' && event.reversed)).toHaveLength(1);
    expect(activity.find((event) => event.kind === 'CANCELLATION')).toMatchObject({
      orderId: orders.o3.id,
      amount: null,
      quantity: null,
    });
    expect(activity.find((event) => event.kind === 'REFUND')).toMatchObject({ orderId: orders.o2.id, amount: 6_000 });
    expect([...activity].map((event) => event.at)).toEqual(
      [...activity]
        .map((event) => event.at)
        .sort()
        .reverse(),
    );

    const clerkUser = await createUser(app, {
      username: 'clerk',
      permissions: ['orders.view', 'customers.view', 'drivers.view', 'items.view'],
    });
    const clerk = await get<DashboardDto>('/api/dashboard', await login(app, clerkUser.username, EMPLOYEE_PASSWORD));
    expect(Object.keys(clerk).sort()).toEqual(['lowStock', 'recentActivity']);
    const plainUser = await createUser(app, { username: 'plain', permissions: [] });
    expect(await get<DashboardDto>('/api/dashboard', await login(app, plainUser.username, EMPLOYEE_PASSWORD))).toEqual(
      {},
    );
  });
});
