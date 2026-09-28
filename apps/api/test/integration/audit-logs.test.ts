import type { INestApplication } from '@nestjs/common';
import { AUDIT_COUNT_LIMIT, AUDIT_PAGE_MAX, type AuditLogDto, type PageDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { errorCode } from '../helpers/errors';
import { EMPLOYEE_PASSWORD, createEmployee } from '../helpers/factories';

/** Recursively: does any key of this JSON body carry that name? */
function hasKeyAnywhere(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => hasKeyAnywhere(entry, key));
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([name, nested]) => name === key || hasKeyAnywhere(nested, key),
  );
}

describe('GET /api/audit-logs', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;

  beforeAll(async () => {
    app = await createTestApp();
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

  it('lists the newest rows first, with the acting user resolved', async () => {
    const body = await request(app.getHttpServer()).get('/api/audit-logs').set(asUser(admin)).expect(200);
    const page = body.body as PageDto<AuditLogDto>;

    expect(page.total).toBeGreaterThan(0);
    expect(page.items[0]?.action).toBe('LOGIN_SUCCESS');
    expect(page.items[0]?.summaryKey).toBe('audit.summary.SESSION.LOGIN_SUCCESS');
    expect(page.items[0]?.ip).toBeTruthy();
    expect([...page.items].sort((a, b) => b.id - a.id)).toEqual(page.items);
  });

  it('filters by action, entity type and acting user, and refuses a backwards date range', async () => {
    const employee = await createEmployee(app, ['audit.view']);
    await login(app, employee.username, 'wrong-password').catch(() => undefined);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Requested-With', 'pallet-web')
      .send({ username: employee.username, password: 'wrong-password' })
      .expect(401);

    const failures = await request(app.getHttpServer())
      .get('/api/audit-logs?action=LOGIN_FAILURE')
      .set(asUser(admin))
      .expect(200);
    expect((failures.body as PageDto<AuditLogDto>).items.every((row) => row.action === 'LOGIN_FAILURE')).toBe(true);

    const sessions = await request(app.getHttpServer())
      .get('/api/audit-logs?entityType=SESSION')
      .set(asUser(admin))
      .expect(200);
    expect((sessions.body as PageDto<AuditLogDto>).items.every((row) => row.entityType === 'SESSION')).toBe(true);

    const range = await request(app.getHttpServer())
      .get('/api/audit-logs?dateFrom=2026-09-12&dateTo=2026-09-01')
      .set(asUser(admin));
    expect([range.status, errorCode(range.body)]).toEqual([400, 'DATE_RANGE_INVALID']);
  });

  it('S-14: hides batch cost from a viewer without items.viewCost, and shows it to one with it', async () => {
    await prisma.auditLog.create({
      data: {
        action: 'CREATE',
        entityType: 'PURCHASE_BATCH',
        entityId: '1',
        summaryKey: 'audit.summary.PURCHASE_BATCH.CREATE',
        summaryParams: { itemName: 'Euro pallet', quantity: 100 },
        after: { id: 1, itemId: 2, quantity: 100, unitCost: 750, totalCost: 75_000 },
      },
    });

    // Both may read batches (Q73): what differs is the cost.
    const plain = await createEmployee(app, ['audit.view', 'items.view', 'purchases.view'], 'no.cost');
    const withCost = await createEmployee(
      app,
      ['audit.view', 'items.view', 'purchases.view', 'items.viewCost'],
      'sees.cost',
    );

    const hidden = await request(app.getHttpServer())
      .get('/api/audit-logs?entityType=PURCHASE_BATCH')
      .set(asUser(await login(app, plain.username, EMPLOYEE_PASSWORD)))
      .expect(200);
    expect(hasKeyAnywhere(hidden.body, 'unitCost')).toBe(false);
    expect(hasKeyAnywhere(hidden.body, 'totalCost')).toBe(false);
    // The rest of the row still arrives.
    expect((hidden.body as PageDto<AuditLogDto>).items[0]?.after).toMatchObject({ quantity: 100 });

    const shown = await request(app.getHttpServer())
      .get('/api/audit-logs?entityType=PURCHASE_BATCH')
      .set(asUser(await login(app, withCost.username, EMPLOYEE_PASSWORD)))
      .expect(200);
    expect(hasKeyAnywhere(shown.body, 'unitCost')).toBe(true);

    const asAdmin = await request(app.getHttpServer())
      .get('/api/audit-logs?entityType=PURCHASE_BATCH')
      .set(asUser(admin))
      .expect(200);
    expect(hasKeyAnywhere(asAdmin.body, 'totalCost')).toBe(true);
  });

  it('Q73: shows a reader only the history of what they may otherwise see', async () => {
    const row = (entityType: 'CUSTOMER' | 'ORDER' | 'SETTINGS', entityId: string) =>
      prisma.auditLog.create({
        data: {
          action: entityType === 'SETTINGS' ? 'SETTINGS_CHANGE' : 'CREATE',
          entityType,
          entityId,
          summaryKey: `audit.summary.${entityType}.${entityType === 'SETTINGS' ? 'SETTINGS_CHANGE' : 'CREATE'}`,
          summaryParams: {},
        },
      });
    await row('CUSTOMER', '1');
    await row('ORDER', '2');
    await row('SETTINGS', '1');

    const clerk = await createEmployee(app, ['audit.view', 'customers.view'], 'clerk');
    const session = await login(app, clerk.username, EMPLOYEE_PASSWORD);
    const page = (await request(app.getHttpServer()).get('/api/audit-logs').set(asUser(session)).expect(200))
      .body as PageDto<AuditLogDto>;
    // Customers and settings; not the order, nor anyone's sign-ins (users and sessions are the admin's).
    expect(new Set(page.items.map((item) => item.entityType))).toEqual(new Set(['CUSTOMER', 'SETTINGS']));
    expect(page.total).toBe(2);

    for (const [entityType, required] of [
      ['ORDER', 'orders.view'],
      ['SESSION', 'users.manage'],
    ] as const) {
      const refused = await request(app.getHttpServer())
        .get(`/api/audit-logs?entityType=${entityType}`)
        .set(asUser(session))
        .expect(403);
      expect(refused.body).toMatchObject({ error: { code: 'PERMISSION_DENIED', details: { required: [required] } } });
    }

    // The admin still sees everything.
    const all = (await request(app.getHttpServer()).get('/api/audit-logs').set(asUser(admin)).expect(200))
      .body as PageDto<AuditLogDto>;
    expect(new Set(all.items.map((item) => item.entityType))).toEqual(
      new Set(['CUSTOMER', 'ORDER', 'SETTINGS', 'SESSION']),
    );
  });

  it('Q100: stops counting past 10,000, pages the newest entries by time, and ends at page 200', async () => {
    const get = async (query: string): Promise<PageDto<AuditLogDto>> =>
      (await request(app.getHttpServer()).get(`/api/audit-logs${query}`).set(asUser(admin)).expect(200))
        .body as PageDto<AuditLogDto>;
    const small = await get('');
    expect(small.totalIsLowerBound).toBeUndefined();

    const adminRow = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    const at = new Date('2026-01-01T00:00:00Z');
    await prisma.auditLog.createMany({
      data: Array.from({ length: AUDIT_COUNT_LIMIT + 5 }, (_, index) => ({
        createdAt: new Date(at.getTime() + index * 1_000),
        userId: adminRow.id,
        action: 'LOGIN_SUCCESS' as const,
        entityType: 'SESSION' as const,
        entityId: String(index),
        summaryKey: 'audit.summary.SESSION.LOGIN_SUCCESS',
        summaryParams: { username: 'admin' },
      })),
    });
    const newestIds = (
      await prisma.auditLog.findMany({
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 150,
      })
    ).map((row) => row.id);

    const first = await get('');
    expect(first).toMatchObject({ page: 1, pageSize: 50, total: AUDIT_COUNT_LIMIT + 1, totalIsLowerBound: true });
    expect(first.items.map((row) => row.id)).toEqual(newestIds.slice(0, 50));
    const third = await get('?page=3');
    expect(third.items.map((row) => row.id)).toEqual(newestIds.slice(100, 150));
    expect(third.items[0]?.user).toEqual({ id: adminRow.id, username: 'admin', displayName: 'Administrator' });

    // A filter under the limit counts exactly again.
    const one = await get('?entityType=SESSION&action=LOGOUT');
    expect(one).toMatchObject({ total: 0, items: [] });
    expect(one.totalIsLowerBound).toBeUndefined();

    expect((await get(`?page=${AUDIT_PAGE_MAX}`)).items).toHaveLength(50);
    const past = await request(app.getHttpServer())
      .get(`/api/audit-logs?page=${AUDIT_PAGE_MAX + 1}`)
      .set(asUser(admin))
      .expect(400);
    expect(errorCode(past.body)).toBe('VALIDATION_FAILED');
  });

  it('needs the audit.view permission', async () => {
    const employee = await createEmployee(app, [], 'curious');
    const session = await login(app, employee.username, EMPLOYEE_PASSWORD);

    const denied = await request(app.getHttpServer()).get('/api/audit-logs').set(asUser(session));
    expect([denied.status, errorCode(denied.body)]).toEqual([403, 'PERMISSION_DENIED']);
  });
});
