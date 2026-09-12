import type { INestApplication } from '@nestjs/common';
import type { PageDto, PurchaseBatchDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { findLedgerDiscrepancies } from '../../src/prisma/reconciliation';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { EMPLOYEE_PASSWORD, createEmployee, createItem } from '../helpers/factories';

/** Midday in Baghdad: "today" is 2026-09-12 for every business date below. */
const NOW = new Date('2026-09-12T09:00:00Z');

describe('purchase batches', () => {
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
  const create = (session: Session, body: Record<string, unknown>): request.Test =>
    http()
      .post('/api/purchase-batches')
      .set(asUser(session))
      .send({ date: '2026-09-10', quantity: 20, unitCost: 700, ...body });
  const patch = (batchId: number, body: Record<string, unknown>): request.Test =>
    http().patch(`/api/purchase-batches/${batchId}`).set(asUser(admin)).send(body);
  const remove = (batchId: number, version: number): request.Test =>
    http().delete(`/api/purchase-batches/${batchId}?version=${version}`).set(asUser(admin));
  const list = async (session: Session, query = ''): Promise<PageDto<PurchaseBatchDto>> =>
    (await http().get(`/api/purchase-batches${query}`).set(asUser(session)).expect(200))
      .body as PageDto<PurchaseBatchDto>;
  const onHand = async (itemId: number): Promise<number> =>
    (await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).quantityOnHand;
  const ledger = (batchId: number): Promise<{ reason: string; quantity: number }[]> =>
    prisma.stockMovement.findMany({
      where: { batchId },
      orderBy: { id: 'asc' },
      select: { reason: true, quantity: true },
    });

  it('adds its pallets to stock, and records it without the cost in the summary', async () => {
    const item = await createItem(app, admin, { stock: 10 });

    const response = await create(admin, { itemId: item.id, note: 'From Duhok' }).expect(201);

    const batch = response.body as PurchaseBatchDto;
    expect(batch).toMatchObject({
      itemId: item.id,
      itemName: 'Euro pallet',
      date: '2026-09-10',
      quantity: 20,
      unitCost: 700,
      totalCost: 14_000,
      note: 'From Duhok',
      version: 1,
      createdBy: { username: 'admin' },
    });
    expect(await onHand(item.id)).toBe(30);
    expect(await ledger(batch.id)).toEqual([{ reason: 'BATCH_ADD', quantity: 20 }]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'PURCHASE_BATCH', entityId: String(batch.id), action: 'CREATE' },
    });
    expect(audit.summaryParams).toEqual({ itemName: 'Euro pallet', quantity: 20, date: '2026-09-10' });
    expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
  });

  it('refuses an unknown item, an archived one and a date after today', async () => {
    const item = await createItem(app, admin);

    const unknown = await create(admin, { itemId: 999_999 }).expect(404);
    expect(unknown.body).toMatchObject({ error: { code: 'ITEM_NOT_FOUND' } });

    const future = await create(admin, { itemId: item.id, date: '2026-09-13' }).expect(400);
    expect(future.body).toMatchObject({
      error: { code: 'BUSINESS_DATE_IN_FUTURE', details: { field: 'date', today: '2026-09-12' } },
    });

    await http().delete(`/api/items/${item.id}?version=1`).set(asUser(admin)).expect(200);
    const archived = await create(admin, { itemId: item.id });
    expect(archived.body).toMatchObject({ error: { code: 'ITEM_ARCHIVED' } });
    expect(await prisma.purchaseBatch.count()).toBe(0);
  });

  it('S-14: never shows cost to a user without items.viewCost — not in lists, replies or history', async () => {
    const item = await createItem(app, admin, { stock: 10 });
    const clerk = await createEmployee(
      app,
      ['items.view', 'purchases.view', 'purchases.create', 'audit.view'],
      'clerk',
    );
    const session = await login(app, clerk.username, EMPLOYEE_PASSWORD);

    // Cost is write-without-read: the clerk enters it but does not get it back.
    const created = await create(session, { itemId: item.id }).expect(201);
    expect(created.body).not.toHaveProperty('unitCost');
    expect(created.body).not.toHaveProperty('totalCost');

    const seen = await list(session);
    expect(seen.items).toHaveLength(2);
    for (const batch of seen.items) expect(Object.keys(batch)).not.toEqual(expect.arrayContaining(['unitCost']));
    expect((await list(admin)).items.map((batch) => batch.totalCost)).toEqual([14_000, 7_000]);

    // The history keeps the cost, and hides it on the way out: the batches' rows and the item's
    // row that carries its first batch.
    for (const entityType of ['PURCHASE_BATCH', 'ITEM']) {
      const history = await http().get(`/api/audit-logs?entityType=${entityType}`).set(asUser(session)).expect(200);
      expect(JSON.stringify(history.body)).not.toMatch(/unitCost|totalCost/);
    }
    // Sorting by cost would leak its order.
    await http().get('/api/purchase-batches?sort=-unitCost').set(asUser(session)).expect(400);
  });

  it('corrects a batch, moving stock by the difference only', async () => {
    const item = await createItem(app, admin, { stock: 10 });
    const batch = (await create(admin, { itemId: item.id }).expect(201)).body as PurchaseBatchDto;

    const response = await patch(batch.id, { version: 1, quantity: 15, unitCost: 800 }).expect(200);

    expect(response.body).toMatchObject({ quantity: 15, unitCost: 800, totalCost: 12_000, version: 2 });
    expect(await onHand(item.id)).toBe(25);
    expect(await ledger(batch.id)).toEqual([
      { reason: 'BATCH_ADD', quantity: 20 },
      { reason: 'BATCH_EDIT', quantity: -5 },
    ]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'PURCHASE_BATCH', action: 'UPDATE' } });
    expect(audit.summaryParams).toEqual({ itemName: 'Euro pallet', quantity: 15, fields: ['quantity', 'unitCost'] });

    // A note alone leaves the ledger as it is.
    await patch(batch.id, { version: 2, note: 'Recounted' }).expect(200);
    expect(await ledger(batch.id)).toHaveLength(2);

    const stale = await patch(batch.id, { version: 2, quantity: 1 }).expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'VERSION_CONFLICT', details: { currentVersion: 3 } } });
    await patch(batch.id, { version: 3 }).expect(400);
    expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
  });

  it('refuses a stale correction for its version before looking at its date (§6.16)', async () => {
    const item = await createItem(app, admin);
    const batch = (await create(admin, { itemId: item.id }).expect(201)).body as PurchaseBatchDto;
    await patch(batch.id, { version: 1, quantity: 25 }).expect(200);

    const stale = await patch(batch.id, { version: 1, date: '2026-09-13' });

    expect(stale.body).toMatchObject({ error: { code: 'VERSION_CONFLICT', details: { currentVersion: 2 } } });
  });

  it('Q37: treats a correction that changes nothing as a no-op', async () => {
    const item = await createItem(app, admin);
    const batch = (await create(admin, { itemId: item.id, note: 'From Duhok' }).expect(201)).body as PurchaseBatchDto;

    const response = await patch(batch.id, {
      version: 1,
      date: '2026-09-10',
      quantity: 20,
      unitCost: 700,
      note: ' From Duhok ',
    }).expect(200);

    expect(response.body).toMatchObject({ version: 1, quantity: 20 });
    expect(await prisma.auditLog.count({ where: { entityType: 'PURCHASE_BATCH', action: 'UPDATE' } })).toBe(0);
    expect(await ledger(batch.id)).toHaveLength(1);
  });

  it('I6: refuses a correction or a delete that would take out pallets already gone', async () => {
    const item = await createItem(app, admin);
    const batch = (await create(admin, { itemId: item.id }).expect(201)).body as PurchaseBatchDto;
    await http()
      .post(`/api/items/${item.id}/stock-adjustments`)
      .set(asUser(admin))
      .send({ quantity: -15, note: 'Sent for repair' })
      .expect(201);

    const shrink = await patch(batch.id, { version: 1, quantity: 2 }).expect(409);
    expect(shrink.body).toMatchObject({
      error: { code: 'STOCK_INSUFFICIENT', details: { items: [{ itemId: item.id, requested: 18, available: 5 }] } },
    });
    const deleted = await remove(batch.id, 1).expect(409);
    expect(deleted.body).toMatchObject({
      error: { code: 'STOCK_INSUFFICIENT', details: { items: [{ itemId: item.id, requested: 20, available: 5 }] } },
    });

    expect(await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({
      quantity: 20,
      version: 1,
      deletedAt: null,
    });
    expect(await onHand(item.id)).toBe(5);
  });

  it('deletes softly: the pallets leave, the ledger keeps both rows, and the batch disappears', async () => {
    const item = await createItem(app, admin, { stock: 10 });
    const batch = (await create(admin, { itemId: item.id }).expect(201)).body as PurchaseBatchDto;

    await remove(batch.id, 1).expect(204);

    expect(await onHand(item.id)).toBe(10);
    expect(await ledger(batch.id)).toEqual([
      { reason: 'BATCH_ADD', quantity: 20 },
      { reason: 'BATCH_DELETE', quantity: -20 },
    ]);
    expect((await list(admin, `?itemId=${item.id}`)).items.map((row) => row.quantity)).toEqual([10]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'PURCHASE_BATCH', action: 'DELETE' } });
    expect(audit.summaryParams).toEqual({ itemName: 'Euro pallet', quantity: 20 });

    const again = await remove(batch.id, 2).expect(404);
    expect(again.body).toMatchObject({ error: { code: 'BATCH_NOT_FOUND' } });
    await patch(batch.id, { version: 2, quantity: 5 }).expect(404);
    expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
  });

  it('still corrects a batch of an archived item', async () => {
    const item = await createItem(app, admin);
    const batch = (await create(admin, { itemId: item.id }).expect(201)).body as PurchaseBatchDto;
    await http().delete(`/api/items/${item.id}?version=1`).set(asUser(admin)).expect(200);

    await patch(batch.id, { version: 1, quantity: 25 }).expect(200);

    expect(await onHand(item.id)).toBe(25);
  });

  it('lists newest first, by item and by date range', async () => {
    const euro = await createItem(app, admin, { name: 'Euro pallet' });
    const half = await createItem(app, admin, { name: 'Half pallet' });
    await create(admin, { itemId: euro.id, date: '2026-09-01' }).expect(201);
    await create(admin, { itemId: euro.id, date: '2026-09-10', quantity: 5 }).expect(201);
    await create(admin, { itemId: half.id, date: '2026-09-05' }).expect(201);

    const dates = async (query: string): Promise<string[]> =>
      (await list(admin, query)).items.map((batch) => batch.date);

    expect(await dates('')).toEqual(['2026-09-10', '2026-09-05', '2026-09-01']);
    expect(await dates(`?itemId=${euro.id}`)).toEqual(['2026-09-10', '2026-09-01']);
    expect(await dates('?dateFrom=2026-09-02&dateTo=2026-09-09')).toEqual(['2026-09-05']);
    expect(await dates('?sort=quantity')).toEqual(['2026-09-10', '2026-09-01', '2026-09-05']);
    const inverted = await http()
      .get('/api/purchase-batches?dateFrom=2026-09-10&dateTo=2026-09-01')
      .set(asUser(admin))
      .expect(400);
    expect(inverted.body).toMatchObject({ error: { code: 'DATE_RANGE_INVALID' } });
  });

  it('lets a viewer read batches but not enter or change them', async () => {
    const item = await createItem(app, admin, { stock: 10 });
    const [batch] = (await list(admin)).items;
    const viewer = await createEmployee(app, ['items.view', 'purchases.view'], 'viewer');
    const session = await login(app, viewer.username, EMPLOYEE_PASSWORD);

    await create(session, { itemId: item.id }).expect(403);
    await http()
      .patch(`/api/purchase-batches/${batch?.id}`)
      .set(asUser(session))
      .send({ version: 1, quantity: 5 })
      .expect(403);
    await http().delete(`/api/purchase-batches/${batch?.id}?version=1`).set(asUser(session)).expect(403);
  });
});
