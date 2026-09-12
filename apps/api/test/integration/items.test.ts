import type { INestApplication } from '@nestjs/common';
import type { ItemDto, PageDto, StockAdjustmentResultDto, StockMovementDto } from '@pallet/shared';
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

describe('items and the stock ledger', () => {
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
  const adjust = (session: Session, itemId: number, quantity: number, note = 'Yard recount'): request.Test =>
    http().post(`/api/items/${itemId}/stock-adjustments`).set(asUser(session)).send({ quantity, note });
  const onHand = async (itemId: number): Promise<number> =>
    (await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).quantityOnHand;

  describe('creating', () => {
    it('records an item with its first batch: the batch, its ledger row and two history rows', async () => {
      const response = await http()
        .post('/api/items')
        .set(asUser(admin))
        .send({
          name: ' Euro pallet ',
          depositPrice: 5_000,
          minStock: 60,
          initialBatch: { date: '2026-09-10', quantity: 50, unitCost: 700, note: '  ' },
        })
        .expect(201);

      const item = response.body as ItemDto;
      expect(item).toMatchObject({
        name: 'Euro pallet',
        depositPrice: 5_000,
        quantityOnHand: 50,
        minStock: 60,
        isLowStock: true,
        quantityOut: 0,
        damagedTotal: 0,
        imageUrl: null,
        archivedAt: null,
        version: 1,
      });

      const batch = await prisma.purchaseBatch.findFirstOrThrow({ where: { itemId: item.id } });
      expect(batch).toMatchObject({ quantity: 50, unitCost: 700n, totalCost: 35_000n, note: null });
      expect(await prisma.stockMovement.findMany({ where: { itemId: item.id } })).toMatchObject([
        { quantity: 50, reason: 'BATCH_ADD', batchId: batch.id },
      ]);

      // The item's row first, then the batch's; neither summary carries the cost (§11.3).
      const history = await prisma.auditLog.findMany({
        where: { action: 'CREATE', entityType: { in: ['ITEM', 'PURCHASE_BATCH'] } },
        orderBy: { id: 'asc' },
      });
      expect(history.map((row) => [row.entityType, row.summaryParams])).toEqual([
        ['ITEM', { name: 'Euro pallet', depositPrice: 5_000, initialQuantity: 50 }],
        ['PURCHASE_BATCH', { itemName: 'Euro pallet', quantity: 50, date: '2026-09-10' }],
      ]);
      expect(history[0]?.after).toMatchObject({
        name: 'Euro pallet',
        initialBatch: { date: '2026-09-10', quantity: 50, unitCost: 700, totalCost: 35_000 },
      });
      expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
    });

    it('needs purchases.create for the first batch, and writes nothing without it', async () => {
      const clerk = await createEmployee(app, ['items.view', 'items.create'], 'clerk');
      const session = await login(app, clerk.username, EMPLOYEE_PASSWORD);
      const body = { name: 'Euro pallet', depositPrice: 5_000 };

      const refused = await http()
        .post('/api/items')
        .set(asUser(session))
        .send({ ...body, initialBatch: { date: '2026-09-10', quantity: 50, unitCost: 700 } })
        .expect(403);

      expect(refused.body).toMatchObject({
        error: { code: 'PERMISSION_DENIED', details: { required: ['purchases.create'] } },
      });
      expect(await prisma.item.count()).toBe(0);
      await http().post('/api/items').set(asUser(session)).send(body).expect(201);
    });

    it('refuses a first batch dated after today in Baghdad', async () => {
      const response = await http()
        .post('/api/items')
        .set(asUser(admin))
        .send({
          name: 'Euro pallet',
          depositPrice: 5_000,
          initialBatch: { date: '2026-09-13', quantity: 50, unitCost: 700 },
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: { code: 'BUSINESS_DATE_IN_FUTURE', details: { field: 'initialBatch.date', today: '2026-09-12' } },
      });
      expect(await prisma.item.count()).toBe(0);
    });

    it('checks the image before the first batch, in the order of §6.15', async () => {
      const response = await http()
        .post('/api/items')
        .set(asUser(admin))
        .send({
          name: 'Euro pallet',
          depositPrice: 5_000,
          imageUploadId: 999_999,
          initialBatch: { date: '2026-09-13', quantity: 50, unitCost: 700 },
        });

      expect(response.body).toMatchObject({ error: { code: 'UPLOAD_NOT_FOUND' } });
    });

    it('refuses a batch whose total cost would not be exact in TypeScript', async () => {
      const response = await http()
        .post('/api/items')
        .set(asUser(admin))
        .send({
          name: 'Euro pallet',
          depositPrice: 5_000,
          initialBatch: { date: '2026-09-10', quantity: 1_000_000, unitCost: 1_000_000_000_000 },
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: { code: 'VALIDATION_FAILED', fields: [{ path: 'initialBatch.unitCost', code: 'too_big' }] },
      });
    });
  });

  it('lists live items by name, with archived, low-stock, search and sort options', async () => {
    await createItem(app, admin, { name: 'Block 100%_off', stock: 5, minStock: 10 });
    await createItem(app, admin, { name: 'Euro pallet', stock: 80, minStock: 10 });
    await createItem(app, admin, { name: 'Half pallet', stock: 1 });
    const old = await createItem(app, admin, { name: 'Old pallet' });
    await http().delete(`/api/items/${old.id}?version=1`).set(asUser(admin)).expect(200);

    const names = async (query: string): Promise<string[]> => {
      const response = await http().get(`/api/items${query}`).set(asUser(admin)).expect(200);
      return (response.body as PageDto<ItemDto>).items.map((item) => item.name);
    };

    expect(await names('')).toEqual(['Block 100%_off', 'Euro pallet', 'Half pallet']);
    expect(await names('?includeArchived=true')).toEqual([
      'Block 100%_off',
      'Euro pallet',
      'Half pallet',
      'Old pallet',
    ]);
    // An item without a minimum is never low, however little is left.
    expect(await names('?lowStockOnly=true')).toEqual(['Block 100%_off']);
    // `%` and `_` are searched for as themselves, not as wildcards.
    expect(await names('?q=%25_')).toEqual(['Block 100%_off']);
    expect(await names('?sort=-quantityOnHand')).toEqual(['Euro pallet', 'Block 100%_off', 'Half pallet']);
    await http().get('/api/items?includeArchived=yes').set(asUser(admin)).expect(400);
  });

  it('I11: edits under the version, recording only what changed', async () => {
    const item = await createItem(app, admin, { depositPrice: 5_000, stock: 10 });

    const response = await http()
      .patch(`/api/items/${item.id}`)
      .set(asUser(admin))
      .send({ version: 1, name: 'Euro pallet', depositPrice: 6_000, minStock: 4 })
      .expect(200);

    expect(response.body).toMatchObject({ depositPrice: 6_000, minStock: 4, quantityOnHand: 10, version: 2 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'ITEM', action: 'UPDATE' } });
    expect(audit.summaryParams).toEqual({ name: 'Euro pallet', fields: ['depositPrice', 'minStock'] });
    expect(audit.before).toEqual({ depositPrice: 5_000, minStock: null });
    expect(audit.after).toEqual({ depositPrice: 6_000, minStock: 4 });

    const stale = await http().patch(`/api/items/${item.id}`).set(asUser(admin)).send({ version: 1, name: 'Late' });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: 'VERSION_CONFLICT', details: { currentVersion: 2 } } });

    // Stock moves without touching the version: an adjustment never makes an open form stale.
    await adjust(admin, item.id, 5).expect(201);
    await http().patch(`/api/items/${item.id}`).set(asUser(admin)).send({ version: 2, minStock: null }).expect(200);
  });

  it('Q37: treats a PATCH that changes nothing as a no-op, after checking its version', async () => {
    const item = await createItem(app, admin, { depositPrice: 5_000 });

    const response = await http()
      .patch(`/api/items/${item.id}`)
      .set(asUser(admin))
      .send({ version: 1, name: 'Euro pallet', depositPrice: 5_000, minStock: null })
      .expect(200);

    expect(response.body).toMatchObject({ version: 1 });
    expect(await prisma.auditLog.count({ where: { entityType: 'ITEM', action: 'UPDATE' } })).toBe(0);
    await http()
      .patch(`/api/items/${item.id}`)
      .set(asUser(admin))
      .send({ version: 7, name: 'Euro pallet' })
      .expect(409);
  });

  it('I15: archives rather than deletes, and an archived item keeps its stock but takes no edits', async () => {
    const item = await createItem(app, admin, { stock: 10 });

    await http().delete(`/api/items/${item.id}`).set(asUser(admin)).expect(400);
    const stale = await http().delete(`/api/items/${item.id}?version=7`).set(asUser(admin)).expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'VERSION_CONFLICT' } });

    const archived = await http().delete(`/api/items/${item.id}?version=1`).set(asUser(admin)).expect(200);
    expect(archived.body).toMatchObject({ archivedAt: NOW.toISOString(), quantityOnHand: 10, version: 2 });

    const again = await http().delete(`/api/items/${item.id}?version=2`).set(asUser(admin));
    expect(again.body).toMatchObject({ error: { code: 'ITEM_ALREADY_ARCHIVED' } });
    const edit = await http().patch(`/api/items/${item.id}`).set(asUser(admin)).send({ version: 2, name: 'Back' });
    expect(edit.body).toMatchObject({ error: { code: 'ITEM_ARCHIVED' } });

    // Still readable, and still countable: a recount does not care whether it is still sold.
    await http().get(`/api/items/${item.id}`).set(asUser(admin)).expect(200);
    await adjust(admin, item.id, -3).expect(201);
    expect(await onHand(item.id)).toBe(7);
  });

  describe('stock adjustments', () => {
    it('move stock with a reason, returning the ledger row and the item', async () => {
      const item = await createItem(app, admin, { stock: 50 });

      const response = await adjust(admin, item.id, -8, '  Broken in the yard ').expect(201);

      const result = response.body as StockAdjustmentResultDto;
      expect(result.item).toMatchObject({ quantityOnHand: 42, version: 1 });
      expect(result.movement).toMatchObject({
        itemId: item.id,
        quantity: -8,
        reason: 'MANUAL_ADJUSTMENT',
        note: 'Broken in the yard',
        balanceAfter: 42,
        createdBy: { username: 'admin' },
      });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'STOCK_ADJUST' } });
      expect(audit).toMatchObject({ entityType: 'ITEM', entityId: String(item.id) });
      expect(audit.summaryParams).toEqual({ name: 'Euro pallet', quantity: -8 });
      expect(audit.before).toEqual({ quantityOnHand: 50 });
      expect(audit.after).toEqual({ quantityOnHand: 42, movement: { quantity: -8, note: 'Broken in the yard' } });
    });

    it('I6: refuse to take out more than is on hand, naming what is short', async () => {
      const item = await createItem(app, admin, { stock: 42 });

      const refused = await adjust(admin, item.id, -43).expect(409);

      expect(refused.body).toMatchObject({
        error: { code: 'STOCK_INSUFFICIENT', details: { items: [{ itemId: item.id, requested: 43, available: 42 }] } },
      });
      expect(await onHand(item.id)).toBe(42);
      await adjust(admin, item.id, -42).expect(201);
      expect(await onHand(item.id)).toBe(0);
    });

    it('refuse a zero quantity, a missing reason and an unknown item', async () => {
      const item = await createItem(app, admin, { stock: 5 });

      await adjust(admin, item.id, 0).expect(400);
      await adjust(admin, item.id, 1, '  ab ').expect(400);
      const missing = await adjust(admin, 999_999, 1).expect(404);
      expect(missing.body).toMatchObject({ error: { code: 'ITEM_NOT_FOUND' } });
    });

    it('I6: serialise on the item lock, so two takes cannot both spend the same pallets', async () => {
      const item = await createItem(app, admin, { stock: 50 });

      const results = await Promise.all([adjust(admin, item.id, -30), adjust(admin, item.id, -30)]);

      expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(await onHand(item.id)).toBe(20);
      expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
    });
  });

  it('I6: the database refuses negative stock even when the application is bypassed', async () => {
    const item = await createItem(app, admin, { stock: 5 });

    await expect(prisma.$executeRaw`UPDATE items SET quantity_on_hand = -1 WHERE id = ${item.id}`).rejects.toThrow(
      /items_quantity_on_hand_nonnegative_check/,
    );
  });

  it('lists the ledger newest first, each row with the stock it left behind', async () => {
    const item = await createItem(app, admin, { stock: 50 });
    await adjust(admin, item.id, -5).expect(201);
    await adjust(admin, item.id, 3).expect(201);

    const rows = async (query: string): Promise<PageDto<StockMovementDto>> =>
      (await http().get(`/api/items/${item.id}/stock-movements${query}`).set(asUser(admin)).expect(200))
        .body as PageDto<StockMovementDto>;
    const summary = (page: PageDto<StockMovementDto>): [string, number, number][] =>
      page.items.map((movement) => [movement.reason, movement.quantity, movement.balanceAfter]);

    const all = await rows('');
    expect(summary(all)).toEqual([
      ['MANUAL_ADJUSTMENT', 3, 48],
      ['MANUAL_ADJUSTMENT', -5, 45],
      ['BATCH_ADD', 50, 50],
    ]);
    expect(all.total).toBe(3);
    // The balance is the whole ledger's, not the filtered or paged rows'.
    expect(summary(await rows('?reason=BATCH_ADD'))).toEqual([['BATCH_ADD', 50, 50]]);
    expect(summary(await rows('?page=2&pageSize=1'))).toEqual([['MANUAL_ADJUSTMENT', -5, 45]]);

    const missing = await http().get('/api/items/999999/stock-movements').set(asUser(admin)).expect(404);
    expect(missing.body).toMatchObject({ error: { code: 'ITEM_NOT_FOUND' } });
  });

  it('lets a viewer read items but not change them', async () => {
    const viewer = await createEmployee(app, ['items.view'], 'viewer');
    const session = await login(app, viewer.username, EMPLOYEE_PASSWORD);
    const item = await createItem(app, admin, { stock: 5 });

    await http().get('/api/items').set(asUser(session)).expect(200);
    await http().get(`/api/items/${item.id}/stock-movements`).set(asUser(session)).expect(200);
    await http().post('/api/items').set(asUser(session)).send({ name: 'Mine', depositPrice: 1 }).expect(403);
    await http().patch(`/api/items/${item.id}`).set(asUser(session)).send({ version: 1, name: 'Mine' }).expect(403);
    await http().delete(`/api/items/${item.id}?version=1`).set(asUser(session)).expect(403);
    await adjust(session, item.id, 1).expect(403);
  });
});
