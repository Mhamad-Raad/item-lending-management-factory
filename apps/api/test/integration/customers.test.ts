import type { INestApplication } from '@nestjs/common';
import type {
  CustomerDetailDto,
  CustomerDto,
  CustomerPhoneCheckDto,
  DashboardDto,
  ItemDto,
  PageDto,
} from '@pallet/shared';
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
  recordPayment,
  recordReturn,
} from '../helpers/factories';

const NOW = new Date('2026-09-12T09:00:00Z');
const BODY = {
  name: 'Kurdistan Cement',
  phone: '0750 123-4567',
  altPhone: null,
  address: 'Erbil, 100 m road',
  creditLimit: 5_000_000,
};

describe('customers', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;

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
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const create = (body: Record<string, unknown>): request.Test =>
    http().post('/api/customers').set(asUser(admin)).send(body);
  const patch = (customerId: number, body: Record<string, unknown>): request.Test =>
    http().patch(`/api/customers/${customerId}`).set(asUser(admin)).send(body);
  const archive = (customerId: number, version: number): request.Test =>
    http().delete(`/api/customers/${customerId}?version=${version}`).set(asUser(admin));
  const names = async (query: string): Promise<string[]> => {
    const response = await http().get(`/api/customers${query}`).set(asUser(admin)).expect(200);
    return (response.body as PageDto<CustomerDto>).items.map((customer) => customer.name);
  };

  it('stores a customer with its phones normalised, and a summary of zeros', async () => {
    const response = await create({ ...BODY, altPhone: '+964 (770) 111-2233' }).expect(201);

    expect(response.body).toMatchObject({
      name: 'Kurdistan Cement',
      phone: '07501234567',
      altPhone: '+9647701112233',
      creditLimit: 5_000_000,
      archivedAt: null,
      version: 1,
      summary: {
        palletsOut: 0,
        outValue: 0,
        owed: 0,
        held: 0,
        compensation: 0,
        creditLimit: 5_000_000,
        headroom: 5_000_000,
        openOrderCount: 0,
      },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'CUSTOMER', action: 'CREATE' } });
    expect(audit.summaryParams).toEqual({ name: 'Kurdistan Cement' });
    expect(audit.after).toMatchObject({ phone: '07501234567', creditLimit: 5_000_000 });
  });

  it('refuses a second number that is the first one, however it is typed', async () => {
    const response = await create({ ...BODY, altPhone: '07501234567' }).expect(400);

    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', fields: [{ path: 'altPhone', code: 'duplicate' }] },
    });
  });

  it('I16: warns about a phone another customer holds, archived ones included, until confirmed', async () => {
    const old = await createCustomer(app, admin, { name: 'Old Blocks', phone: '07501111111', altPhone: '07709998877' });
    await archive(old.id, 1).expect(200);

    const warned = await create({ ...BODY, phone: '0770 999 8877' }).expect(409);

    expect(warned.body).toMatchObject({
      error: {
        code: 'CUSTOMER_PHONE_DUPLICATE',
        details: {
          matches: [
            {
              customerId: old.id,
              name: 'Old Blocks',
              archived: true,
              matchedField: 'altPhone',
              matchedValue: '07709998877',
            },
          ],
        },
      },
    });
    expect(await prisma.customer.count()).toBe(1);
    await create({ ...BODY, phone: '0770 999 8877', confirmDuplicatePhone: true }).expect(201);
  });

  it('answers the live phone check, leaving out the customer being edited', async () => {
    const first = await createCustomer(app, admin, { name: 'Ashti Blocks', phone: '07501234567' });
    const second = await createCustomer(app, admin, {
      name: 'Baban Cement',
      phone: '07702223344',
      altPhone: '07501234567',
      confirm: true,
    });
    const check = async (query: string): Promise<CustomerPhoneCheckDto> =>
      (await http().get(`/api/customers/phone-check${query}`).set(asUser(admin)).expect(200))
        .body as CustomerPhoneCheckDto;

    expect(await check('?phone=0750%20123-4567')).toEqual({
      normalizedPhone: '07501234567',
      matches: [
        { customerId: first.id, name: 'Ashti Blocks', archived: false, matchedField: 'phone' },
        { customerId: second.id, name: 'Baban Cement', archived: false, matchedField: 'altPhone' },
      ],
    });
    expect((await check(`?phone=07501234567&excludeId=${first.id}`)).matches).toHaveLength(1);
    await http().get('/api/customers/phone-check?phone=12ab').set(asUser(admin)).expect(400);
  });

  it('lists by name, searching names and phones as typed, with archived and open-order filters', async () => {
    const ashti = await createCustomer(app, admin, { name: 'Ashti Blocks', phone: '07501111111' });
    const baban = await createCustomer(app, admin, {
      name: 'Baban Cement',
      phone: '07502222222',
      altPhone: '07703333333',
    });
    const zagros = await createCustomer(app, admin, { name: 'Zagros Trading', phone: '07504444444' });
    await archive(zagros.id, 1).expect(200);
    const driver = await createDriver(app, admin);
    const item = await createItem(app, admin, { stock: 10 });
    await createOrder(app, admin, {
      customerId: baban.id,
      driverId: driver.id,
      lines: [{ itemId: item.id, quantity: 5 }],
    });
    // A cancelled order is no order at all for the summary.
    const cancelled = await createOrder(app, admin, {
      customerId: ashti.id,
      driverId: driver.id,
      lines: [{ itemId: item.id, quantity: 5 }],
    });
    await http().post(`/api/orders/${cancelled.id}/cancel`).set(asUser(admin)).send({ version: 1 }).expect(200);

    expect(await names('')).toEqual(['Ashti Blocks', 'Baban Cement']);
    expect(await names('?includeArchived=true')).toEqual(['Ashti Blocks', 'Baban Cement', 'Zagros Trading']);
    expect(await names('?q=ASHTI')).toEqual(['Ashti Blocks']);
    expect(await names('?q=0770%20333')).toEqual(['Baban Cement']);
    expect(await names('?hasOpenOrders=true')).toEqual(['Baban Cement']);
    expect(await names('?hasOpenOrders=false')).toEqual(['Ashti Blocks']);
  });

  it('sums the orders that are not cancelled, shows what is held per item, and sorts by the sums', async () => {
    const item = await createItem(app, admin, { depositPrice: 5_000, stock: 80 });
    const driver = await createDriver(app, admin);
    const ashti = await createCustomer(app, admin, {
      name: 'Ashti Blocks',
      phone: '07501111111',
      creditLimit: 100_000,
    });
    const baban = await createCustomer(app, admin, { name: 'Baban Cement', phone: '07502222222' });
    // 10 × 5,000 lent; 4 come back (credit 20,000) and 10,000 is paid: 20,000 owed against 30,000 out.
    const order = await createOrder(app, admin, {
      customerId: ashti.id,
      driverId: driver.id,
      lines: [{ itemId: item.id, quantity: 10 }],
    });
    await recordReturn(app, admin, {
      orderId: order.id,
      date: '2026-09-10',
      lines: [{ orderLineId: order.lines[0]?.id ?? 0, acceptedQuantity: 4 }],
    });
    await recordPayment(app, admin, { orderId: order.id, amount: 10_000, date: '2026-09-11' });
    const cancelled = await createOrder(app, admin, {
      customerId: ashti.id,
      driverId: driver.id,
      lines: [{ itemId: item.id, quantity: 10 }],
    });
    await http().post(`/api/orders/${cancelled.id}/cancel`).set(asUser(admin)).send({ version: 1 }).expect(200);
    await createOrder(app, admin, {
      customerId: baban.id,
      driverId: driver.id,
      lines: [{ itemId: item.id, quantity: 20 }],
    });

    const detail = (await http().get(`/api/customers/${ashti.id}`).set(asUser(admin)).expect(200))
      .body as CustomerDetailDto;

    expect(detail.summary).toEqual({
      palletsOut: 6,
      outValue: 30_000,
      owed: 20_000,
      held: 10_000,
      compensation: 0,
      creditLimit: 100_000,
      headroom: 70_000,
      openOrderCount: 1,
    });
    expect(detail.holdings).toEqual([
      {
        item: { id: item.id, name: 'Euro pallet', imageUrl: null, archived: false },
        quantityOut: 6,
        outValue: 30_000,
        sources: [
          {
            orderId: order.id,
            orderNumber: order.orderNumber,
            orderDate: '2026-09-10',
            quantityOut: 6,
            unitDeposit: 5_000,
          },
        ],
      },
    ]);
    expect(detail.palletsOutByItem).toEqual([{ itemId: item.id, itemName: 'Euro pallet', quantityOut: 6 }]);
    expect(await names('?sort=-outValue')).toEqual(['Baban Cement', 'Ashti Blocks']);
    expect(await names('?sort=palletsOut')).toEqual(['Ashti Blocks', 'Baban Cement']);

    // The item's own count of pallets out reads the same orders (§6.15).
    const stock = (await http().get(`/api/items/${item.id}`).set(asUser(admin)).expect(200)).body as ItemDto;
    expect(stock.quantityOut).toBe(26);
  });

  it('Q62 — reads open orders for what stands, keeps compensation past settlement, ignores reversed damage', async () => {
    const driver = await createDriver(app, admin);
    const item = await createItem(app, admin, { name: 'Euro pallet', depositPrice: 5_000, stock: 100 });
    const customer = await createCustomer(app, admin, { name: 'Dilan Blocks', phone: '07503333333' });
    const line = (order: { lines: { id: number }[] }) => order.lines[0]?.id ?? 0;
    const cash = (quantity: number) =>
      createOrder(app, admin, {
        customerId: customer.id,
        driverId: driver.id,
        paymentType: 'CASH',
        lines: [{ itemId: item.id, quantity }],
      });

    // A: paid, 8 back and 2 damaged — settled, and the 10,000 of compensation stays assessed.
    const settled = await cash(10);
    await recordReturn(app, admin, {
      orderId: settled.id,
      date: '2026-09-11',
      lines: [{ orderLineId: line(settled), acceptedQuantity: 8, damagedQuantity: 2 }],
    });
    // B: paid, 3 reported damaged, then that return deleted — nothing damaged, all 10 still out.
    const reversed = await cash(10);
    const wrong = await recordReturn(app, admin, {
      orderId: reversed.id,
      date: '2026-09-11',
      lines: [{ orderLineId: line(reversed), acceptedQuantity: 0, damagedQuantity: 3 }],
    });
    await http().delete(`/api/returns/${wrong}`).set(asUser(admin)).expect(200);
    // C: lent, 1 damaged — 3 out, 20,000 owed, 5,000 of compensation.
    const lent = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      lines: [{ itemId: item.id, quantity: 4 }],
    });
    await recordReturn(app, admin, {
      orderId: lent.id,
      date: '2026-09-11',
      lines: [{ orderLineId: line(lent), acceptedQuantity: 0, damagedQuantity: 1 }],
    });

    const statuses = await prisma.order.findMany({ where: { customerId: customer.id }, orderBy: { id: 'asc' } });
    expect(statuses.map((order) => order.status)).toEqual(['SETTLED', 'OPEN', 'OPEN']);

    const summary = {
      palletsOut: 13, // B 10 + C 3
      outValue: 65_000,
      owed: 20_000, // C only
      held: 50_000, // B holds its whole paid deposit; C owes more than it holds
      compensation: 15_000, // A 10,000 (settled) + C 5,000; B's deleted damage is gone
      openOrderCount: 2,
    };
    const detail = (await http().get(`/api/customers/${customer.id}`).set(asUser(admin)).expect(200))
      .body as CustomerDetailDto;
    expect(detail.summary).toMatchObject(summary);
    const listed = (await http().get('/api/customers').set(asUser(admin)).expect(200)).body as PageDto<CustomerDto>;
    expect(listed.items.find((row) => row.id === customer.id)?.summary).toMatchObject(summary);

    const stocked = (await http().get(`/api/items/${item.id}`).set(asUser(admin)).expect(200)).body as ItemDto;
    expect(stocked).toMatchObject({ quantityOut: 13, damagedTotal: 3 }); // A 2 + C 1

    const dashboard = (await http().get('/api/dashboard').set(asUser(admin)).expect(200)).body as DashboardDto;
    expect(dashboard.positions).toEqual({
      palletsOut: 13,
      outValue: 65_000,
      owed: 20_000,
      held: 50_000,
      openOrderCount: 2,
      customersWithOpenOrders: 1,
    });

    // The equivalence the queries rely on is the database's: a settled order cannot carry anything standing.
    await expect(prisma.$executeRaw`UPDATE orders SET owed = 1 WHERE id = ${settled.id}`).rejects.toThrow(
      /orders_settled_nothing_standing_check/,
    );
  });

  it('edits under the version, checks only a phone that changes, and a no-op writes nothing (Q37)', async () => {
    const ashti = await createCustomer(app, admin, { name: 'Ashti Blocks', phone: '07501111111' });
    await createCustomer(app, admin, { name: 'Baban Cement', phone: '07502222222' });

    const same = await patch(ashti.id, { version: 1, name: 'Ashti Blocks', phone: '0750 111 1111' }).expect(200);
    expect(same.body).toMatchObject({ version: 1 });
    expect(await prisma.auditLog.count({ where: { entityType: 'CUSTOMER', action: 'UPDATE' } })).toBe(0);

    const warned = await patch(ashti.id, { version: 1, phone: '07502222222' }).expect(409);
    expect(warned.body).toMatchObject({ error: { code: 'CUSTOMER_PHONE_DUPLICATE' } });
    await patch(ashti.id, { version: 1, phone: '07502222222', confirmDuplicatePhone: true }).expect(200);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'CUSTOMER', action: 'UPDATE' } });
    expect(audit.summaryParams).toEqual({ name: 'Ashti Blocks', fields: ['phone'] });
    expect(audit.before).toEqual({ phone: '07501111111' });
    expect(audit.after).toEqual({ phone: '07502222222' });

    // The shared phone was confirmed once; an edit that leaves it alone is not warned again.
    await patch(ashti.id, { version: 2, address: 'Duhok' }).expect(200);
    const clash = await patch(ashti.id, { version: 3, altPhone: '0750 222 2222' }).expect(400);
    expect(clash.body).toMatchObject({ error: { fields: [{ path: 'altPhone', code: 'duplicate' }] } });

    const stale = await patch(ashti.id, { version: 1, name: 'Late' }).expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'VERSION_CONFLICT', details: { currentVersion: 3 } } });
    await patch(ashti.id, { version: 3, confirmDuplicatePhone: true }).expect(400);
  });

  it('archives only a customer with nothing open, and an archived one takes no edits', async () => {
    const customer = await createCustomer(app, admin);
    const driver = await createDriver(app, admin);
    const item = await createItem(app, admin, { stock: 5 });
    const order = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      lines: [{ itemId: item.id, quantity: 5 }],
    });

    const refused = await archive(customer.id, 1).expect(409);
    expect(refused.body).toMatchObject({ error: { code: 'CUSTOMER_HAS_OPEN_ORDERS', details: { openOrderCount: 1 } } });

    // Every pallet back, nothing owed: the order settles and the customer may go.
    await recordReturn(app, admin, {
      orderId: order.id,
      date: '2026-09-12',
      lines: [{ orderLineId: order.lines[0]?.id ?? 0, acceptedQuantity: 5 }],
    });
    const archived = await archive(customer.id, 1).expect(200);
    expect(archived.body).toMatchObject({ archivedAt: NOW.toISOString(), version: 2 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'CUSTOMER', action: 'DELETE' } });
    expect(audit.summaryParams).toEqual({ name: 'Kurdistan Cement' });

    expect((await archive(customer.id, 2)).body).toMatchObject({ error: { code: 'CUSTOMER_ALREADY_ARCHIVED' } });
    expect((await patch(customer.id, { version: 2, name: 'Back' })).body).toMatchObject({
      error: { code: 'CUSTOMER_ARCHIVED' },
    });
    await http().get(`/api/customers/${customer.id}`).set(asUser(admin)).expect(200);
    const missing = await http().get('/api/customers/999999').set(asUser(admin)).expect(404);
    expect(missing.body).toMatchObject({ error: { code: 'CUSTOMER_NOT_FOUND' } });
  });

  it('lets a viewer read customers but not change them', async () => {
    const viewer = await createEmployee(app, ['customers.view'], 'viewer');
    const session = await login(app, viewer.username, EMPLOYEE_PASSWORD);
    const customer = await createCustomer(app, admin);

    await http().get('/api/customers').set(asUser(session)).expect(200);
    await http().get('/api/customers/phone-check?phone=07501234567').set(asUser(session)).expect(200);
    await http().post('/api/customers').set(asUser(session)).send(BODY).expect(403);
    await http()
      .patch(`/api/customers/${customer.id}`)
      .set(asUser(session))
      .send({ version: 1, name: 'x' })
      .expect(403);
    await http().delete(`/api/customers/${customer.id}?version=1`).set(asUser(session)).expect(403);
  });
});
