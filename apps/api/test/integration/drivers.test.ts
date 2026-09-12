import type { INestApplication } from '@nestjs/common';
import type { DriverDto, PageDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { createCustomer, createDriver, createItem, insertOrder } from '../helpers/factories';

const NOW = new Date('2026-09-12T09:00:00Z');

describe('drivers', () => {
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
  const patch = (driverId: number, body: Record<string, unknown>): request.Test =>
    http().patch(`/api/drivers/${driverId}`).set(asUser(admin)).send(body);
  const archive = (driverId: number, version: number): request.Test =>
    http().delete(`/api/drivers/${driverId}?version=${version}`).set(asUser(admin));

  it('stores a driver with the phone normalised, with no duplicate check (Q13)', async () => {
    const body = { name: 'Karwan Aziz', phone: '0770 111-2233', carNumber: ' Erbil 12 A 34567 ' };

    const response = await http().post('/api/drivers').set(asUser(admin)).send(body).expect(201);

    expect(response.body).toMatchObject({
      name: 'Karwan Aziz',
      phone: '07701112233',
      carNumber: 'Erbil 12 A 34567',
      archivedAt: null,
      version: 1,
    });
    await http()
      .post('/api/drivers')
      .set(asUser(admin))
      .send({ ...body, name: 'Karwan’s brother' })
      .expect(201);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'DRIVER', action: 'CREATE' } });
    expect(audit.summaryParams).toEqual({ name: 'Karwan Aziz' });
  });

  it('lists by name, searching the name, the phone as typed and the car number', async () => {
    await createDriver(app, admin, { name: 'Karwan Aziz', phone: '07701112233', carNumber: 'Erbil 12 A 34567' });
    await createDriver(app, admin, { name: 'Dilshad Omar', phone: '07502223344', carNumber: 'Duhok 21 B 555' });
    const gone = await createDriver(app, admin, { name: 'Omar Salih', phone: '07503334455' });
    await archive(gone.id, 1).expect(200);

    const names = async (query: string): Promise<string[]> =>
      ((await http().get(`/api/drivers${query}`).set(asUser(admin)).expect(200)).body as PageDto<DriverDto>).items.map(
        (driver) => driver.name,
      );

    expect(await names('')).toEqual(['Dilshad Omar', 'Karwan Aziz']);
    expect(await names('?includeArchived=true')).toEqual(['Dilshad Omar', 'Karwan Aziz', 'Omar Salih']);
    expect(await names('?q=duhok')).toEqual(['Dilshad Omar']);
    expect(await names('?q=0770%20111')).toEqual(['Karwan Aziz']);
    expect(await names('?sort=-name')).toEqual(['Karwan Aziz', 'Dilshad Omar']);
  });

  it('edits under the version, recording only what changed, and a no-op writes nothing (Q37)', async () => {
    const driver = await createDriver(app, admin);

    const same = await patch(driver.id, { version: 1, phone: '0770 111 2233' }).expect(200);
    expect(same.body).toMatchObject({ version: 1 });
    expect(await prisma.auditLog.count({ where: { entityType: 'DRIVER', action: 'UPDATE' } })).toBe(0);

    const changed = await patch(driver.id, { version: 1, carNumber: 'Erbil 99 C 1' }).expect(200);
    expect(changed.body).toMatchObject({ carNumber: 'Erbil 99 C 1', version: 2 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'DRIVER', action: 'UPDATE' } });
    expect(audit.summaryParams).toEqual({ name: 'Karwan Aziz', fields: ['carNumber'] });
    expect(audit.before).toEqual({ carNumber: 'Erbil 12 A 34567' });

    const stale = await patch(driver.id, { version: 1, name: 'Late' }).expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'VERSION_CONFLICT', details: { currentVersion: 2 } } });
    await patch(driver.id, { version: 2 }).expect(400);
  });

  it('archives at any time — even with open orders — and an archived driver takes no edits', async () => {
    const driver = await createDriver(app, admin);
    const customer = await createCustomer(app, admin);
    const item = await createItem(app, admin);
    await insertOrder(app, {
      customerId: customer.id,
      driverId: driver.id,
      lines: [{ itemId: item.id, quantity: 5, unitDeposit: 1_000 }],
    });

    const archived = await archive(driver.id, 1).expect(200);

    expect(archived.body).toMatchObject({ archivedAt: NOW.toISOString(), version: 2 });
    expect((await archive(driver.id, 2)).body).toMatchObject({ error: { code: 'DRIVER_ALREADY_ARCHIVED' } });
    expect((await patch(driver.id, { version: 2, name: 'Back' })).body).toMatchObject({
      error: { code: 'DRIVER_ARCHIVED' },
    });
    await http().get(`/api/drivers/${driver.id}`).set(asUser(admin)).expect(200);
    const missing = await http().get('/api/drivers/999999').set(asUser(admin)).expect(404);
    expect(missing.body).toMatchObject({ error: { code: 'DRIVER_NOT_FOUND' } });
  });
});
