import type { INestApplication } from '@nestjs/common';
import { closePermissionSet, type GrantablePermissionKey } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionDeclarationCheck } from '../../src/common/checks/permission-declaration.check';
import { UploadThrottleGuard } from '../../src/modules/uploads/upload-throttle.guard';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { EMPLOYEE_PASSWORD, createEmployee, type CreatedUser } from '../helpers/factories';

type Rule = ReturnType<PermissionDeclarationCheck['scan']>[number]['rule'];

const PUBLIC: Rule = { kind: 'public' };
const AUTHENTICATED: Rule = { kind: 'authenticated' };
const ADMIN_ONLY: Rule = { kind: 'adminOnly' };
const all = (...keys: GrantablePermissionKey[]): Rule => ({ kind: 'all', keys });
const any = (...keys: GrantablePermissionKey[]): Rule => ({ kind: 'any', keys });

/**
 * §6.26, for the routes built so far. A route added later fails the comparison until it is written
 * here, which is the point: its access is then checked against the table, not against itself.
 * `GET /api/customers/:id/history` arrives with M4.
 */
const ROUTE_ACCESS: Record<string, Rule> = {
  'POST /api/auth/login': PUBLIC,
  'POST /api/auth/refresh': PUBLIC,
  'POST /api/auth/logout': PUBLIC,
  'POST /api/auth/logout-all': AUTHENTICATED,
  'GET /api/auth/me': AUTHENTICATED,
  'POST /api/auth/change-password': AUTHENTICATED,
  'GET /api/users': ADMIN_ONLY,
  'POST /api/users': ADMIN_ONLY,
  'GET /api/users/:id': ADMIN_ONLY,
  'PATCH /api/users/:id': ADMIN_ONLY,
  'PUT /api/users/:id/permissions': ADMIN_ONLY,
  'POST /api/users/:id/reset-password': ADMIN_ONLY,
  'POST /api/users/:id/logout-all': ADMIN_ONLY,
  'GET /api/settings': AUTHENTICATED,
  'PUT /api/settings': ADMIN_ONLY,
  'POST /api/uploads': any('items.create', 'items.edit'),
  'GET /api/uploads/:fileName': PUBLIC,
  'GET /api/items': all('items.view'),
  'GET /api/items/:id': all('items.view'),
  'POST /api/items': all('items.create'),
  'PATCH /api/items/:id': all('items.edit'),
  'DELETE /api/items/:id': all('items.delete'),
  'POST /api/items/:id/stock-adjustments': all('items.adjustStock'),
  'GET /api/items/:id/stock-movements': all('items.view'),
  'GET /api/purchase-batches': all('purchases.view'),
  'POST /api/purchase-batches': all('purchases.create'),
  'PATCH /api/purchase-batches/:id': all('purchases.edit'),
  'DELETE /api/purchase-batches/:id': all('purchases.delete'),
  'GET /api/customers': all('customers.view'),
  'GET /api/customers/phone-check': all('customers.view'),
  'GET /api/customers/:id': all('customers.view'),
  'POST /api/customers': all('customers.create'),
  'PATCH /api/customers/:id': all('customers.edit'),
  'DELETE /api/customers/:id': all('customers.delete'),
  'GET /api/drivers': all('drivers.view'),
  'GET /api/drivers/:id': all('drivers.view'),
  'POST /api/drivers': all('drivers.create'),
  'PATCH /api/drivers/:id': all('drivers.edit'),
  'DELETE /api/drivers/:id': all('drivers.delete'),
  'GET /api/orders': all('orders.view'),
  'GET /api/orders/:id': all('orders.view'),
  'POST /api/orders': all('orders.create'),
  'PATCH /api/orders/:id': all('orders.edit'),
  'POST /api/orders/:id/cancel': all('orders.cancel'),
  'GET /api/orders/:id/receipt': all('orders.view'),
  'GET /api/ledger-entries': all('orders.view'),
  'POST /api/orders/:orderId/returns': all('returns.create'),
  'POST /api/returns/:id/replace': all('returns.edit'),
  'DELETE /api/returns/:id': all('returns.delete'),
  'GET /api/audit-logs': all('audit.view'),
  'GET /api/health': PUBLIC,
};

/**
 * S-12, driven by the routes the application itself declares — the same scan that fails startup on
 * a missing declaration — so a new endpoint is covered the moment it exists.
 */
describe('S-12: permission denial over the endpoint catalogue', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let employee: CreatedUser;
  let session: Session;

  beforeAll(async () => {
    app = await createTestApp({
      customise: (builder) => builder.overrideGuard(UploadThrottleGuard).useValue({ canActivate: () => true }),
    });
    prisma = app.get(PrismaService);
    await resetDatabase();
    employee = await createEmployee(app, [], 'catalogue');
    session = await login(app, employee.username, EMPLOYEE_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  /** Permissions are read from the database on every request, so a grant applies to the next one. */
  const grant = async (keys: Iterable<GrantablePermissionKey>): Promise<void> => {
    await prisma.userPermission.deleteMany({ where: { userId: employee.id } });
    await prisma.userPermission.createMany({
      data: [...keys].map((permissionKey) => ({ userId: employee.id, permissionKey })),
    });
  };

  /** Calls a route with every path parameter set to 1 and an empty body: the guards run before validation. */
  const call = (route: string): request.Test => {
    const [method, path = ''] = route.split(' ');
    const url = path.replace(/:[A-Za-z]+/g, '1');
    const agent = request(app.getHttpServer());
    const test =
      method === 'GET'
        ? agent.get(url)
        : method === 'POST'
          ? agent.post(url).send({})
          : method === 'PUT'
            ? agent.put(url).send({})
            : method === 'PATCH'
              ? agent.patch(url).send({})
              : agent.delete(url);
    return test.set(asUser(session));
  };

  it('refuses an employee without permissions on every gated route, and admits one holding its keys', async () => {
    const gated = app
      .get(PermissionDeclarationCheck)
      .scan()
      .filter(({ rule }) => rule.kind !== 'public' && rule.kind !== 'authenticated');
    expect(gated.map(({ route }) => route)).toEqual(
      expect.arrayContaining(['GET /api/customers/phone-check', 'DELETE /api/drivers/:id', 'PUT /api/settings']),
    );

    const failures: string[] = [];
    for (const { route, rule } of gated) {
      await grant([]);
      const denied = await call(route);
      const expectedCode = rule.kind === 'adminOnly' ? 'ADMIN_ONLY' : 'PERMISSION_DENIED';
      const deniedCode = (denied.body as { error?: { code?: string } }).error?.code;
      if (denied.status !== 403 || deniedCode !== expectedCode) {
        failures.push(`${route} with no permissions → ${denied.status} ${deniedCode ?? ''}`);
      }

      // "All of" needs every key; "any of" is satisfied by each key alone. Dependencies come along,
      // as the permissions form grants them (§6.4.2).
      const grants = rule.kind === 'all' ? [rule.keys] : rule.kind === 'any' ? rule.keys.map((key) => [key]) : [];
      for (const keys of grants) {
        await grant(closePermissionSet(keys));
        const admitted = await call(route);
        if (admitted.status === 403) failures.push(`${route} holding ${keys.join(' + ')} → 403`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('declares for every route exactly the access of the §6.26 table', () => {
    const declared = Object.fromEntries(
      app
        .get(PermissionDeclarationCheck)
        .scan()
        .map(({ route, rule }) => [route, rule]),
    );

    expect(declared).toEqual(ROUTE_ACCESS);
  });
});
