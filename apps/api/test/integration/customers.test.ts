import type { INestApplication } from '@nestjs/common';
import type { CustomerDetailDto, CustomerDto, CustomerPhoneCheckDto, ItemDto, PageDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { skipReconciliation } from '../helpers/reconciliation';
import {
  EMPLOYEE_PASSWORD,
  createCustomer,
  createDriver,
  createEmployee,
  createItem,
  insertOrder,
} from '../helpers/factories';

const NOW = new Date('2026-09-12T09:00:00Z');
const BODY = {
  name: 'Kurdistan Cement',
  phone: '0750 123-4567',
  altPhone: null,
  address: 'Erbil, 100 m road',
  creditLimit: 5_000_000,
};

// Built with insertOrder (returned pallets, owed and held set by hand) until M4 brings returns and
// payments to record them for real; those rows do not reconcile.
skipReconciliation('orders inserted directly, without stock movements or ledger rows');

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
    const item = await createItem(app, admin);
    await insertOrder(app, {
      customerId: baban.id,
      driverId: driver.id,
      lines: [{ itemId: item.id, quantity: 5, unitDeposit: 1_000 }],
    });
    // A cancelled order is no order at all for the summary.
    await insertOrder(app, {
      customerId: ashti.id,
      driverId: driver.id,
      cancelled: true,
      lines: [{ itemId: item.id, quantity: 5, unitDeposit: 1_000 }],
    });

    expect(await names('')).toEqual(['Ashti Blocks', 'Baban Cement']);
    expect(await names('?includeArchived=true')).toEqual(['Ashti Blocks', 'Baban Cement', 'Zagros Trading']);
    expect(await names('?q=ASHTI')).toEqual(['Ashti Blocks']);
    expect(await names('?q=0770%20333')).toEqual(['Baban Cement']);
    expect(await names('?hasOpenOrders=true')).toEqual(['Baban Cement']);
    expect(await names('?hasOpenOrders=false')).toEqual(['Ashti Blocks']);
  });

  it('sums the orders that are not cancelled, shows what is held per item, and sorts by the sums', async () => {
    const item = await createItem(app, admin, { depositPrice: 5_000 });
    const driver = await createDriver(app, admin);
    const ashti = await createCustomer(app, admin, {
      name: 'Ashti Blocks',
      phone: '07501111111',
      creditLimit: 100_000,
    });
    const baban = await createCustomer(app, admin, { name: 'Baban Cement', phone: '07502222222' });
    const order = await insertOrder(app, {
      customerId: ashti.id,
      driverId: driver.id,
      owed: 20_000,
      held: 10_000,
      lines: [{ itemId: item.id, quantity: 10, unitDeposit: 5_000, returned: 4 }],
    });
    await insertOrder(app, {
      customerId: ashti.id,
      driverId: driver.id,
      cancelled: true,
      lines: [{ itemId: item.id, quantity: 50, unitDeposit: 5_000 }],
    });
    await insertOrder(app, {
      customerId: baban.id,
      driverId: driver.id,
      lines: [{ itemId: item.id, quantity: 20, unitDeposit: 5_000 }],
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
    const item = await createItem(app, admin);
    const order = await insertOrder(app, {
      customerId: customer.id,
      driverId: driver.id,
      lines: [{ itemId: item.id, quantity: 5, unitDeposit: 1_000 }],
    });

    const refused = await archive(customer.id, 1).expect(409);
    expect(refused.body).toMatchObject({ error: { code: 'CUSTOMER_HAS_OPEN_ORDERS', details: { openOrderCount: 1 } } });

    await prisma.order.update({ where: { id: order.id }, data: { status: 'SETTLED' } });
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
