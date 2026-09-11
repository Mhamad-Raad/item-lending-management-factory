import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { EMPLOYEE_PASSWORD, createEmployee, createUser } from '../helpers/factories';

function errorCode(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

describe('what an admin action does to the target user', () => {
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

  it('S-11: a permission change takes effect on the next request, with no new login', async () => {
    const employee = await createEmployee(app, []);
    const session = await login(app, employee.username, EMPLOYEE_PASSWORD);

    const before = await request(app.getHttpServer()).get('/api/audit-logs').set(asUser(session));
    expect([before.status, errorCode(before.body)]).toEqual([403, 'PERMISSION_DENIED']);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: employee.id } });
    await request(app.getHttpServer())
      .put(`/api/users/${employee.id}/permissions`)
      .set(asUser(admin))
      .send({ version: row.version, permissions: ['audit.view'] })
      .expect(200);

    // Same access token, no refresh: permissions are read from the database per request.
    await request(app.getHttpServer()).get('/api/audit-logs').set(asUser(session)).expect(200);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: employee.id } });
    await request(app.getHttpServer())
      .put(`/api/users/${employee.id}/permissions`)
      .set(asUser(admin))
      .send({ version: updated.version, permissions: [] })
      .expect(200);

    const after = await request(app.getHttpServer()).get('/api/audit-logs').set(asUser(session));
    expect([after.status, errorCode(after.body)]).toEqual([403, 'PERMISSION_DENIED']);
    expect(await prisma.sessionFamily.count({ where: { userId: employee.id, revokedAt: null } })).toBe(1);
  });

  it('S-10: deactivation kills the access token and the refresh cookie', async () => {
    const employee = await createEmployee(app, ['audit.view']);
    const session = await login(app, employee.username, EMPLOYEE_PASSWORD);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: employee.id } });

    await request(app.getHttpServer())
      .patch(`/api/users/${employee.id}`)
      .set(asUser(admin))
      .send({ version: row.version, isActive: false })
      .expect(200);

    const blocked = await request(app.getHttpServer()).get('/api/audit-logs').set(asUser(session));
    expect([blocked.status, errorCode(blocked.body)]).toEqual([401, 'AUTH_TOKEN_INVALID']);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('X-Requested-With', 'pallet-web')
      .set('Cookie', session.cookie)
      .expect(401);

    expect(await prisma.sessionFamily.count({ where: { revokedReason: 'USER_DEACTIVATED' } })).toBe(1);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Requested-With', 'pallet-web')
      .send({
        username: employee.username,
        password: EMPLOYEE_PASSWORD,
      })
      .expect(401);
  });

  it('S-10: a password reset ends every session and forces a new password', async () => {
    const employee = await createEmployee(app, ['audit.view']);
    const session = await login(app, employee.username, EMPLOYEE_PASSWORD);

    await request(app.getHttpServer())
      .post(`/api/users/${employee.id}/reset-password`)
      .set(asUser(admin))
      .send({ newPassword: 'a-brand-new-password' })
      .expect(204);

    await request(app.getHttpServer()).get('/api/audit-logs').set(asUser(session)).expect(401);
    expect(await prisma.sessionFamily.count({ where: { revokedReason: 'PASSWORD_RESET' } })).toBe(1);

    const fresh = await login(app, employee.username, 'a-brand-new-password');
    const me = await request(app.getHttpServer()).get('/api/auth/me').set(asUser(fresh)).expect(200);
    expect((me.body as { mustChangePassword: boolean }).mustChangePassword).toBe(true);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'PASSWORD_RESET' } });
    expect(JSON.stringify(audit)).not.toContain('a-brand-new-password');
  });

  it('logs a user out everywhere on request', async () => {
    const employee = await createUser(app, { username: 'busy.hands' });
    const sessions = [
      await login(app, employee.username, EMPLOYEE_PASSWORD),
      await login(app, employee.username, EMPLOYEE_PASSWORD),
    ];

    await request(app.getHttpServer()).post(`/api/users/${employee.id}/logout-all`).set(asUser(admin)).expect(204);

    for (const session of sessions) {
      await request(app.getHttpServer()).get('/api/auth/me').set(asUser(session)).expect(401);
    }
    expect(await prisma.sessionFamily.count({ where: { userId: employee.id, revokedAt: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'LOGOUT_ALL' } })).toBe(1);
  });

  it('refuses a stale version and an unknown user', async () => {
    const employee = await createEmployee(app, []);

    const stale = await request(app.getHttpServer())
      .patch(`/api/users/${employee.id}`)
      .set(asUser(admin))
      .send({ version: 99, displayName: 'Ghost' });
    expect([stale.status, errorCode(stale.body)]).toEqual([409, 'VERSION_CONFLICT']);
    expect((stale.body as { error: { details: { currentVersion: number } } }).error.details.currentVersion).toBe(1);

    const missing = await request(app.getHttpServer()).get('/api/users/999999').set(asUser(admin));
    expect([missing.status, errorCode(missing.body)]).toEqual([404, 'USER_NOT_FOUND']);
  });
});
