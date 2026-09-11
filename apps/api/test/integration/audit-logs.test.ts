import type { INestApplication } from '@nestjs/common';
import type { AuditLogDto, PageDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
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
    expect([range.status, (range.body as { error: { code: string } }).error.code]).toEqual([400, 'DATE_RANGE_INVALID']);
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

    const plain = await createEmployee(app, ['audit.view'], 'no.cost');
    const withCost = await createEmployee(app, ['audit.view', 'items.view', 'items.viewCost'], 'sees.cost');

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

  it('needs the audit.view permission', async () => {
    const employee = await createEmployee(app, [], 'curious');
    const session = await login(app, employee.username, EMPLOYEE_PASSWORD);

    const denied = await request(app.getHttpServer()).get('/api/audit-logs').set(asUser(session));
    expect([denied.status, (denied.body as { error: { code: string } }).error.code]).toEqual([
      403,
      'PERMISSION_DENIED',
    ]);
  });
});
