import type { INestApplication } from '@nestjs/common';
import { GRANTABLE_PERMISSION_KEYS, type PageDto, type UserDto, type UserListItemDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { TEST_ADMIN, disconnectDatabase, resetDatabase } from '../helpers/db';
import { EMPLOYEE_PASSWORD, createEmployee, createUser } from '../helpers/factories';

function errorCode(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

describe('user management', () => {
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

  it('creates a user who must set their own password, with the permissions asked for', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set(asUser(admin))
      .send({
        username: 'Warehouse.One',
        displayName: 'Warehouse One',
        role: 'EMPLOYEE',
        password: 'a-perfectly-fine-password',
        permissions: ['orders.view', 'customers.view', 'drivers.view', 'items.view'],
      })
      .expect(201);

    const user = response.body as UserDto;
    expect(user).toMatchObject({ username: 'warehouse.one', mustChangePassword: true, isActive: true, version: 1 });
    expect(user.permissions).toEqual(['customers.view', 'drivers.view', 'items.view', 'orders.view']);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'CREATE', entityType: 'USER' } });
    expect(audit.summaryParams).toMatchObject({ username: 'warehouse.one', role: 'EMPLOYEE' });
    expect(JSON.stringify(audit.after)).not.toContain('a-perfectly-fine-password');
  });

  it('refuses a duplicate username, a weak password and a permission set that cannot stand', async () => {
    const body = {
      username: 'clash',
      displayName: 'Clash',
      role: 'EMPLOYEE' as const,
      password: 'a-perfectly-fine-password',
    };
    await request(app.getHttpServer()).post('/api/users').set(asUser(admin)).send(body).expect(201);

    const cases: [Record<string, unknown>, number, string][] = [
      [body, 409, 'USERNAME_TAKEN'],
      [{ ...body, username: 'weak', password: 'short' }, 400, 'PASSWORD_TOO_SHORT'],
      [{ ...body, username: 'common', password: 'password123' }, 400, 'PASSWORD_TOO_COMMON'],
      [{ ...body, username: 'boss', role: 'ADMIN', permissions: ['items.view'] }, 409, 'PERMISSIONS_ADMIN_IMPLICIT'],
      [{ ...body, username: 'ghost', permissions: ['items.fly'] }, 400, 'PERMISSION_KEY_UNKNOWN'],
      [{ ...body, username: 'climber', permissions: ['users.manage'] }, 400, 'PERMISSION_NOT_GRANTABLE'],
      [{ ...body, username: 'partial', permissions: ['orders.create'] }, 400, 'PERMISSION_DEPENDENCY_MISSING'],
    ];

    for (const [payload, status, code] of cases) {
      const response = await request(app.getHttpServer()).post('/api/users').set(asUser(admin)).send(payload);
      expect([response.status, errorCode(response.body)], JSON.stringify(payload)).toEqual([status, code]);
    }
  });

  it('lists, filters, searches, sorts and pages', async () => {
    await createUser(app, { username: 'zed.worker' });
    await createUser(app, { username: 'amy.worker' });
    await createUser(app, { username: 'gone.worker', isActive: false });
    // Logging in gives amy a lastLoginAt; the others have never signed in.
    await login(app, 'amy.worker', EMPLOYEE_PASSWORD);

    const list = async (query: string): Promise<PageDto<UserListItemDto>> =>
      (await request(app.getHttpServer()).get(`/api/users${query}`).set(asUser(admin)).expect(200))
        .body as PageDto<UserListItemDto>;

    const all = await list('');
    expect(all.total).toBe(4);
    expect(all.items.map((user) => user.username)).toEqual(['admin', 'amy.worker', 'gone.worker', 'zed.worker']);

    expect((await list('?isActive=false')).items.map((user) => user.username)).toEqual(['gone.worker']);
    expect((await list('?role=ADMIN')).items.map((user) => user.username)).toEqual(['admin']);
    expect((await list('?q=worker')).total).toBe(3);
    // The search box is text, not a pattern: a literal wildcard matches nothing here.
    expect((await list('?q=%25')).total).toBe(0);
    expect((await list('?q=a_min')).total).toBe(0);
    expect((await list('?q=admin')).items.map((user) => user.username)).toEqual(['admin']);

    // Most recent login first must not be headed by the users who never logged in: amy signed in
    // after the admin of `beforeEach`, and the other two have never signed in at all.
    const byLogin = await list('?sort=-lastLoginAt');
    // The two who never signed in tie, so they fall back to the deterministic `id` order.
    expect(byLogin.items.map((user) => user.username)).toEqual(['amy.worker', 'admin', 'zed.worker', 'gone.worker']);
    expect(byLogin.items.slice(2).every((user) => user.lastLoginAt === null)).toBe(true);
    expect((await list('?sort=-username')).items[0]?.username).toBe('zed.worker');

    const firstPage = await list('?pageSize=2&page=1');
    const secondPage = await list('?pageSize=2&page=2');
    expect([firstPage.items.length, secondPage.items.length, secondPage.page, secondPage.total]).toEqual([2, 2, 2, 4]);
    expect(firstPage.items.map((user) => user.id)).not.toEqual(secondPage.items.map((user) => user.id));
  });

  it('reports one user with their permissions and live session count', async () => {
    const employee = await createEmployee(app, ['items.view', 'orders.view']);
    await login(app, employee.username, EMPLOYEE_PASSWORD);
    await login(app, employee.username, EMPLOYEE_PASSWORD);

    const response = await request(app.getHttpServer()).get(`/api/users/${employee.id}`).set(asUser(admin)).expect(200);

    expect(response.body).toMatchObject({
      username: employee.username,
      role: 'EMPLOYEE',
      permissions: ['items.view', 'orders.view'],
      activeSessionCount: 2,
    });
  });

  it('names the user it could not find', async () => {
    const response = await request(app.getHttpServer()).get('/api/users/424242').set(asUser(admin)).expect(404);

    expect(response.body).toMatchObject({ error: { code: 'USER_NOT_FOUND', details: { userId: 424242 } } });
  });

  it('refuses to set permissions on an admin, even an empty set', async () => {
    const self = await prisma.user.findUniqueOrThrow({ where: { username: TEST_ADMIN.username } });

    const response = await request(app.getHttpServer())
      .put(`/api/users/${self.id}/permissions`)
      .set(asUser(admin))
      .send({ version: self.version, permissions: [] });

    expect([response.status, errorCode(response.body)]).toEqual([409, 'PERMISSIONS_ADMIN_IMPLICIT']);
  });

  it('Q37: treats an edit that changes nothing as a no-op, after checking its version', async () => {
    const clerk = await createEmployee(app, [], 'clerk');

    const response = await request(app.getHttpServer())
      .patch(`/api/users/${clerk.id}`)
      .set(asUser(admin))
      .send({ version: 1, displayName: 'clerk', isActive: true })
      .expect(200);

    expect((response.body as UserDto).version).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'USER', entityId: String(clerk.id) } })).toBe(0);
    await request(app.getHttpServer())
      .patch(`/api/users/${clerk.id}`)
      .set(asUser(admin))
      .send({ version: 5, displayName: 'clerk' })
      .expect(409);
  });

  it('S-15: refuses self-deactivation, self-demotion and removing the last admin', async () => {
    const self = await prisma.user.findUniqueOrThrow({ where: { username: TEST_ADMIN.username } });

    const deactivateSelf = await request(app.getHttpServer())
      .patch(`/api/users/${self.id}`)
      .set(asUser(admin))
      .send({ version: self.version, isActive: false });
    expect([deactivateSelf.status, errorCode(deactivateSelf.body)]).toEqual([409, 'SELF_DEACTIVATE_FORBIDDEN']);

    const demoteSelf = await request(app.getHttpServer())
      .patch(`/api/users/${self.id}`)
      .set(asUser(admin))
      .send({ version: self.version, role: 'EMPLOYEE' });
    expect([demoteSelf.status, errorCode(demoteSelf.body)]).toEqual([409, 'SELF_DEMOTE_FORBIDDEN']);

    // A second admin may be demoted by the first, but not when they are the only one left.
    const other = await createUser(app, { username: 'second.admin', role: 'ADMIN' });
    const otherSession = await login(app, other.username, EMPLOYEE_PASSWORD);
    const otherRow = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });

    const demoteTheOnlyOther = await request(app.getHttpServer())
      .patch(`/api/users/${self.id}`)
      .set(asUser(otherSession))
      .send({ version: self.version, role: 'EMPLOYEE' });
    expect(demoteTheOnlyOther.status).toBe(200);

    const lastOne = await request(app.getHttpServer())
      .patch(`/api/users/${other.id}`)
      .set(asUser(otherSession))
      .send({ version: otherRow.version, isActive: false });
    expect([lastOne.status, errorCode(lastOne.body)]).toEqual([409, 'SELF_DEACTIVATE_FORBIDDEN']);
  });

  it('S-15: lets exactly one of two concurrent demotions succeed', async () => {
    const first = await createUser(app, { username: 'admin.one', role: 'ADMIN' });
    const second = await createUser(app, { username: 'admin.two', role: 'ADMIN' });
    const selfRow = await prisma.user.findUniqueOrThrow({ where: { username: TEST_ADMIN.username } });

    // The seeded admin steps aside first, leaving exactly two.
    await request(app.getHttpServer())
      .patch(`/api/users/${selfRow.id}`)
      .set(asUser(await login(app, first.username, EMPLOYEE_PASSWORD)))
      .send({ version: selfRow.version, isActive: false })
      .expect(200);

    const sessionOne = await login(app, first.username, EMPLOYEE_PASSWORD);
    const sessionTwo = await login(app, second.username, EMPLOYEE_PASSWORD);
    const [rowOne, rowTwo] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: first.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: second.id } }),
    ]);

    const results = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/users/${second.id}`)
        .set(asUser(sessionOne))
        .send({ version: rowTwo.version, role: 'EMPLOYEE' }),
      request(app.getHttpServer())
        .patch(`/api/users/${first.id}`)
        .set(asUser(sessionTwo))
        .send({ version: rowOne.version, role: 'EMPLOYEE' }),
    ]);

    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(await prisma.user.count({ where: { role: 'ADMIN', isActive: true } })).toBe(1);
  });

  it('S-13: refuses every user route to an employee holding all grantable permissions', async () => {
    const employee = await createEmployee(app, GRANTABLE_PERMISSION_KEYS);
    const session = await login(app, employee.username, EMPLOYEE_PASSWORD);

    const routes: [string, string][] = [
      ['get', '/api/users'],
      ['post', '/api/users'],
      ['get', `/api/users/${employee.id}`],
      ['patch', `/api/users/${employee.id}`],
      ['put', `/api/users/${employee.id}/permissions`],
      ['post', `/api/users/${employee.id}/reset-password`],
      ['post', `/api/users/${employee.id}/logout-all`],
    ];

    for (const [method, path] of routes) {
      const response = await request(app.getHttpServer())[method as 'get'](path).set(asUser(session)).send({});
      expect([path, response.status, errorCode(response.body)]).toEqual([path, 403, 'ADMIN_ONLY']);
    }
  });

  it('S-16: blocks a user who must change their password from the rest of the API', async () => {
    const fresh = await createUser(app, { username: 'fresh.hire', mustChangePassword: true });
    const session = await login(app, fresh.username, EMPLOYEE_PASSWORD);

    const blocked = await request(app.getHttpServer()).get('/api/users').set(asUser(session));
    expect([blocked.status, errorCode(blocked.body)]).toEqual([403, 'PASSWORD_CHANGE_REQUIRED']);

    await request(app.getHttpServer()).get('/api/auth/me').set(asUser(session)).expect(200);
  });
});
