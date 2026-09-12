import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type {
  CustomerDetailDto,
  CustomerDto,
  DriverDto,
  ItemDto,
  OrderDetailDto,
  OrderListItemDto,
  PageDto,
} from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { findLedgerDiscrepancies } from '../../src/prisma/reconciliation';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { EMPLOYEE_PASSWORD, createCustomer, createDriver, createEmployee, createItem } from '../helpers/factories';

/** "today = 2026-09-11" of the worked examples (§4.10), midday in Baghdad. */
const NOW = new Date('2026-09-11T09:00:00Z');

/** What every creation row of §4.10 shows, by payment type: 100 × 1,000 handed over. */
const CREATED = {
  CASH: { depositTotal: 100_000, paymentsNet: 100_000, owed: 0, outValue: 100_000, held: 100_000 },
  LENT: { depositTotal: 100_000, paymentsNet: 0, owed: 100_000, outValue: 100_000, held: 0 },
} as const;

const CLERK_PERMISSIONS = ['orders.view', 'orders.create', 'customers.view', 'drivers.view', 'items.view'] as const;

describe('orders: creation, credit and idempotency (§4.8.1, §6.7, §6.19)', () => {
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
    // The common setup of §4.10: item P at 1,000 with 500 on hand, customer C without a limit, driver D.
    item = await createItem(app, admin, { name: 'Pallet 120×100', depositPrice: 1_000, stock: 500 });
    customer = await createCustomer(app, admin);
    driver = await createDriver(app, admin);
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const post = (session: Session, body: Record<string, unknown>, key: string = randomUUID()): request.Test =>
    http().post('/api/orders').set(asUser(session)).set('Idempotency-Key', key).send(body);
  const orderBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    customerId: customer.id,
    driverId: driver.id,
    date: '2026-09-11',
    paymentType: 'LENT',
    lines: [{ itemId: item.id, quantity: 100 }],
    ...overrides,
  });
  const onHand = async (itemId: number): Promise<number> =>
    (await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).quantityOnHand;
  const clerkSession = async (): Promise<Session> => {
    const clerk = await createEmployee(app, CLERK_PERMISSIONS, 'clerk');
    return login(app, clerk.username, EMPLOYEE_PASSWORD);
  };

  it.each([
    ['E1', 'CASH'],
    ['E2', 'CASH'],
    ['E3', 'LENT'],
    ['E4', 'LENT'],
    ['E5', 'LENT'],
    ['E7', 'CASH'],
    ['E8', 'CASH'],
    ['E9', 'LENT'],
  ] as const)('%s — the creation row: %s 100 × 1,000', async (_example, paymentType) => {
    const response = await post(admin, orderBody({ paymentType })).expect(201);

    const order = response.body as OrderDetailDto;
    expect(order).toMatchObject({
      orderNumber: 1,
      paymentType,
      status: 'OPEN',
      ...CREATED[paymentType],
      creditsTotal: 0,
      refundsNet: 0,
      compensation: 0,
      outQuantityTotal: 100,
      canEditLines: true,
      canCancel: true,
      version: 1,
    });
    expect(order.lines).toMatchObject([{ quantity: 100, unitDeposit: 1_000, lineTotal: 100_000, outQuantity: 100 }]);
    expect(order.ledgerEntries).toMatchObject(
      paymentType === 'CASH'
        ? [
            {
              type: 'PAYMENT',
              source: 'ORDER_CREATE',
              amount: 100_000,
              isAutomatic: true,
              date: null,
              effectiveDate: '2026-09-11',
            },
          ]
        : [],
    );
    expect(await onHand(item.id)).toBe(400);
    expect(
      await prisma.stockMovement.findMany({ where: { orderId: order.id }, select: { reason: true, quantity: true } }),
    ).toEqual([{ reason: 'ORDER_CREATE', quantity: -100 }]);
    const profile = (await http().get(`/api/customers/${customer.id}`).set(asUser(admin)).expect(200))
      .body as CustomerDetailDto;
    expect(profile.summary.outValue).toBe(100_000);
    expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
  });

  it('records the hand-over in the history, and numbers orders one after another', async () => {
    await post(admin, orderBody({ paymentType: 'CASH' })).expect(201);

    const rows = await prisma.auditLog.findMany({
      where: { entityType: { in: ['ORDER', 'LEDGER_ENTRY'] } },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((row) => [row.entityType, row.action, row.summaryParams])).toEqual([
      ['ORDER', 'CREATE', { orderNumber: 1, customerName: customer.name, paymentType: 'CASH', depositTotal: 100_000 }],
      ['LEDGER_ENTRY', 'PAYMENT_CREATE', { orderNumber: 1, amount: 100_000, automatic: true }],
    ]);
    expect(rows[0]?.after).toMatchObject({
      orderNumber: 1,
      date: '2026-09-11',
      depositTotal: 100_000,
      lines: [{ itemId: item.id, quantity: 100, unitDeposit: 1_000, lineTotal: 100_000 }],
    });

    const second = await post(admin, orderBody({ lines: [{ itemId: item.id, quantity: 5 }] })).expect(201);
    expect((second.body as OrderDetailDto).orderNumber).toBe(2);
  });

  it('refuses more pallets than there are, naming every short line, and writes nothing', async () => {
    const half = await createItem(app, admin, { name: 'Half pallet', stock: 3 });

    const refused = await post(
      admin,
      orderBody({
        lines: [
          { itemId: item.id, quantity: 501 },
          { itemId: half.id, quantity: 4 },
        ],
      }),
    ).expect(409);

    expect(refused.body).toMatchObject({
      error: {
        code: 'STOCK_INSUFFICIENT',
        details: {
          items: [
            { itemId: item.id, requested: 501, available: 500 },
            { itemId: half.id, requested: 4, available: 3 },
          ],
        },
      },
    });
    expect(await prisma.order.count()).toBe(0);
    expect((await prisma.orderCounter.findUniqueOrThrow({ where: { id: 1 } })).lastNumber).toBe(0);
  });

  it('lets only a user who may set unit deposits set them, and refuses a repeated item on its line', async () => {
    const half = await createItem(app, admin, { name: 'Half pallet', stock: 50 });
    const clerk = await clerkSession();

    const priced = await post(
      clerk,
      orderBody({
        lines: [
          { itemId: item.id, quantity: 10 },
          { itemId: half.id, quantity: 5, unitDeposit: 800 },
        ],
      }),
    ).expect(403);
    expect(priced.body).toMatchObject({ error: { code: 'UNIT_DEPOSIT_NOT_PERMITTED', details: { lineIndexes: [1] } } });
    const override = await post(clerk, orderBody({ confirmCreditOverride: true })).expect(403);
    expect(override.body).toMatchObject({ error: { code: 'ADMIN_ONLY' } });

    const repeated = await post(
      admin,
      orderBody({
        lines: [
          { itemId: item.id, quantity: 1 },
          { itemId: item.id, quantity: 2 },
        ],
      }),
    ).expect(400);
    expect(repeated.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', fields: [{ path: 'lines.1.itemId', code: 'duplicate' }] },
    });

    const adminPriced = await post(
      admin,
      orderBody({ lines: [{ itemId: item.id, quantity: 10, unitDeposit: 800 }] }),
    ).expect(201);
    expect((adminPriced.body as OrderDetailDto).lines).toMatchObject([{ unitDeposit: 800, lineTotal: 8_000 }]);
  });

  it('refuses an unknown or archived customer, an archived driver or item, and a date after today', async () => {
    const future = await post(admin, orderBody({ date: '2026-09-12' })).expect(400);
    expect(future.body).toMatchObject({ error: { code: 'BUSINESS_DATE_IN_FUTURE', details: { field: 'date' } } });

    const unknown = await post(admin, orderBody({ customerId: 999_999 })).expect(404);
    expect(unknown.body).toMatchObject({ error: { code: 'CUSTOMER_NOT_FOUND' } });

    const gone = await createDriver(app, admin, { name: 'Omar Salih', phone: '07503334455' });
    await http().delete(`/api/drivers/${gone.id}?version=1`).set(asUser(admin)).expect(200);
    expect((await post(admin, orderBody({ driverId: gone.id }))).body).toMatchObject({
      error: { code: 'DRIVER_ARCHIVED' },
    });

    const old = await createItem(app, admin, { name: 'Old pallet', stock: 10 });
    await http().delete(`/api/items/${old.id}?version=1`).set(asUser(admin)).expect(200);
    const archivedItem = await post(admin, orderBody({ lines: [{ itemId: old.id, quantity: 1 }] }));
    expect(archivedItem.body).toMatchObject({ error: { code: 'ITEM_ARCHIVED', details: { itemId: old.id } } });

    await http().delete(`/api/customers/${customer.id}?version=1`).set(asUser(admin)).expect(200);
    expect((await post(admin, orderBody())).body).toMatchObject({ error: { code: 'CUSTOMER_ARCHIVED' } });
    expect(await prisma.order.count()).toBe(0);
  });

  it('§4.4: stops an order past the credit limit — an employee cannot pass it, an admin can, on the record', async () => {
    const limited = await createCustomer(app, admin, {
      name: 'Limited Blocks',
      phone: '07509998877',
      creditLimit: 150_000,
    });
    await post(admin, orderBody({ customerId: limited.id })).expect(201);
    const second = orderBody({ customerId: limited.id, lines: [{ itemId: item.id, quantity: 60 }] });
    const excess = { creditLimit: 150_000, customerOutValue: 100_000, depositDelta: 60_000, excess: 10_000 };

    const clerk = await clerkSession();
    const refused = await post(clerk, second).expect(409);
    expect(refused.body).toMatchObject({
      error: { code: 'CREDIT_LIMIT_EXCEEDED', details: { ...excess, canOverride: false } },
    });

    const key = randomUUID();
    const asked = await post(admin, second, key).expect(409);
    expect(asked.body).toMatchObject({ error: { code: 'CREDIT_LIMIT_EXCEEDED', details: { canOverride: true } } });
    // The override re-submits the same order on the same key, which the refusal left unused (§6.7 step 6).
    const confirmed = await post(admin, { ...second, confirmCreditOverride: true }, key).expect(201);

    expect((confirmed.body as OrderDetailDto).creditOverride).toMatchObject({ by: { username: 'admin' } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'CREDIT_OVERRIDE' } });
    expect(audit.summaryParams).toEqual({ orderNumber: 2, customerName: 'Limited Blocks', excess: 10_000 });
    expect(audit.after).toEqual(excess);

    // Within the limit an override is not recorded, even when one is sent.
    const within = await post(
      admin,
      orderBody({ lines: [{ itemId: item.id, quantity: 1 }], confirmCreditOverride: true }),
    ).expect(201);
    expect((within.body as OrderDetailDto).creditOverride).toBeNull();
    expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
  });

  it('§6.7: needs a well-formed key, creates once per key, replays the answer, refuses a key reused', async () => {
    const noKey = await http().post('/api/orders').set(asUser(admin)).send(orderBody()).expect(400);
    expect(noKey.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
    const badKey = await post(admin, orderBody(), 'too-short').expect(400);
    expect(badKey.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_INVALID' } });

    const key = randomUUID();
    const first = await post(admin, orderBody(), key).expect(201);
    const again = await post(admin, orderBody(), key).expect(201);

    expect(first.headers['idempotency-replayed']).toBeUndefined();
    expect(again.headers['idempotency-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(await prisma.order.count()).toBe(1);
    expect(await onHand(item.id)).toBe(400);

    const reused = await post(admin, orderBody({ lines: [{ itemId: item.id, quantity: 5 }] }), key).expect(409);
    expect(reused.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('§6.7: a retry is answered from the stored order even when the request would now be refused', async () => {
    const pricer = await createEmployee(app, [...CLERK_PERMISSIONS, 'orders.editUnitDeposit'], 'pricer');
    const session = await login(app, pricer.username, EMPLOYEE_PASSWORD);
    const body = orderBody({ lines: [{ itemId: item.id, quantity: 10, unitDeposit: 800 }] });
    const key = randomUUID();
    const first = await post(session, body, key).expect(201);

    // The response was lost, and the permission taken away before the automatic retry.
    await prisma.userPermission.deleteMany({ where: { userId: pricer.id, permissionKey: 'orders.editUnitDeposit' } });
    const retry = await post(session, body, key).expect(201);

    expect(retry.headers['idempotency-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect(await prisma.order.count()).toBe(1);
    // A new submission is judged by today's permissions.
    await post(session, body).expect(403);
  });

  it('§6.7: two submissions racing on one key create one order, and both get its answer', async () => {
    const key = randomUUID();

    const [a, b] = await Promise.all([post(admin, orderBody(), key), post(admin, orderBody(), key)]);

    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.headers['idempotency-replayed'], b.headers['idempotency-replayed']].filter(Boolean)).toEqual(['true']);
    expect(a.body).toEqual(b.body);
    expect(await prisma.order.count()).toBe(1);
    expect(await onHand(item.id)).toBe(400);
  });

  it('§6.7: a double submit that takes the last of the stock is answered twice, not refused the second time', async () => {
    const scarce = await createItem(app, admin, { name: 'Scarce pallet', depositPrice: 1_000, stock: 60 });
    const body = orderBody({ lines: [{ itemId: scarce.id, quantity: 60 }] });
    const key = randomUUID();

    // The second waits for the customer lock, then must find the first one's answer, not an empty yard.
    const [a, b] = await Promise.all([post(admin, body, key), post(admin, body, key)]);

    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body).toEqual(b.body);
    expect(await prisma.order.count()).toBe(1);
    expect(await onHand(scarce.id)).toBe(0);
  });

  it('lists open orders newest first, filters them, and shows one in full', async () => {
    const baban = await createCustomer(app, admin, { name: 'Baban Cement', phone: '07502223344' });
    const half = await createItem(app, admin, { name: 'Half pallet', stock: 50 });
    const first = (await post(admin, orderBody({ paymentType: 'CASH' })).expect(201)).body as OrderDetailDto;
    await post(admin, orderBody({ customerId: baban.id, lines: [{ itemId: half.id, quantity: 5 }] })).expect(201);

    const numbers = async (query: string): Promise<number[]> =>
      (
        (await http().get(`/api/orders${query}`).set(asUser(admin)).expect(200)).body as PageDto<OrderListItemDto>
      ).items.map((order) => order.orderNumber);

    expect(await numbers('')).toEqual([2, 1]);
    expect(await numbers(`?customerId=${baban.id}`)).toEqual([2]);
    expect(await numbers('?paymentType=CASH')).toEqual([1]);
    expect(await numbers(`?itemId=${half.id}`)).toEqual([2]);
    expect(await numbers('?q=1')).toEqual([1]);
    expect(await numbers('?q=baban')).toEqual([2]);
    expect(await numbers('?status=SETTLED')).toEqual([]);
    expect(await numbers('?sort=orderNumber')).toEqual([1, 2]);
    await http().get('/api/orders?dateFrom=2026-09-11&dateTo=2026-09-01').set(asUser(admin)).expect(400);

    const detail = (await http().get(`/api/orders/${first.id}`).set(asUser(admin)).expect(200)).body as OrderDetailDto;
    expect(detail).toMatchObject({
      orderNumber: 1,
      customer: { id: customer.id, name: customer.name, archived: false },
      driver: { id: driver.id, carNumber: driver.carNumber },
      lines: [{ item: { id: item.id, name: 'Pallet 120×100', imageUrl: null, archived: false } }],
      returns: [],
      cancelledAt: null,
      creditOverride: null,
      createdBy: { username: 'admin' },
    });
    const missing = await http().get('/api/orders/999999').set(asUser(admin)).expect(404);
    expect(missing.body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND' } });
  });
});
