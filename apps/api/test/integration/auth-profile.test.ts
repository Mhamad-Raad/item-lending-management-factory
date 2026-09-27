import type { INestApplication } from '@nestjs/common';
import type { MeDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { errorCode } from '../helpers/errors';
import { createEmployee, createUser, type CreatedUser } from '../helpers/factories';

/** `PATCH /api/auth/me` (Q94): a signed-in user renames themselves, and nothing else. */
describe('own display name', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let employee: CreatedUser;
  let session: Session;

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
    employee = await createEmployee(app, ['orders.view']);
    session = await login(app, employee.username, employee.password);
  });

  const patch = (body: unknown, as: Session = session) =>
    request(app.getHttpServer())
      .patch('/api/auth/me')
      .set(asUser(as))
      .send(body as object);

  it('renames the caller, answers the new MeDto and records the change with before and after', async () => {
    const response = await patch({ version: 1, displayName: '  Karwan Aziz  ' }).expect(200);

    const me = response.body as MeDto;
    expect(me).toMatchObject({
      id: employee.id,
      username: employee.username,
      displayName: 'Karwan Aziz',
      role: 'EMPLOYEE',
      permissions: ['orders.view'],
      version: 2,
    });
    const reread = await request(app.getHttpServer()).get('/api/auth/me').set(asUser(session)).expect(200);
    expect(reread.body).toEqual(me);

    const rows = await prisma.auditLog.findMany({ where: { entityType: 'USER', entityId: String(employee.id) } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'UPDATE',
      userId: employee.id,
      summaryParams: { username: employee.username, fields: ['displayName'] },
      before: expect.objectContaining({ displayName: employee.username }) as unknown,
      after: expect.objectContaining({ displayName: 'Karwan Aziz' }) as unknown,
    });
  });

  it('touches only the caller: no id is accepted and another user is left as they were', async () => {
    const other = await createUser(app, { username: 'other.worker' });

    for (const body of [
      { version: 1, displayName: 'Taken over', id: other.id },
      { version: 1, displayName: 'Taken over', userId: other.id },
    ]) {
      const response = await patch(body).expect(400);
      expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
    }
    await request(app.getHttpServer())
      .patch(`/api/auth/me/${other.id}`)
      .set(asUser(session))
      .send({ version: 1, displayName: 'Taken over' })
      .expect(404);

    const rows = await prisma.user.findMany({ where: { id: { in: [employee.id, other.id] } }, orderBy: { id: 'asc' } });
    expect(rows.map((row) => [row.displayName, row.version])).toEqual([
      [employee.username, 1],
      ['other.worker', 1],
    ]);
  });

  it('refuses every other field of the user row', async () => {
    for (const extra of [
      { username: 'renamed' },
      { role: 'ADMIN' },
      { isActive: false },
      { password: 'a-new-long-password' },
      { mustChangePassword: false },
      { permissions: ['users.manage'] },
    ]) {
      const response = await patch({ version: 1, displayName: 'Karwan', ...extra }).expect(400);
      expect(response.body, JSON.stringify(extra)).toMatchObject({
        error: { code: 'VALIDATION_FAILED', fields: [{ path: Object.keys(extra)[0], code: 'unknown_key' }] },
      });
    }

    const row = await prisma.user.findUniqueOrThrow({ where: { id: employee.id } });
    expect(row).toMatchObject({ username: employee.username, role: 'EMPLOYEE', isActive: true, version: 1 });
  });

  it('validates the name as the admin form does', async () => {
    const cases: [unknown, string, string][] = [
      [{ version: 1, displayName: '   ' }, 'displayName', 'too_short'],
      [{ version: 1, displayName: 'x'.repeat(101) }, 'displayName', 'too_long'],
      [{ version: 1 }, 'displayName', 'required'],
      [{ displayName: 'Karwan' }, 'version', 'required'],
    ];
    for (const [body, path, code] of cases) {
      const response = await patch(body).expect(400);
      expect(response.body, JSON.stringify(body)).toMatchObject({
        error: { code: 'VALIDATION_FAILED', fields: [{ path, code }] },
      });
    }
  });

  it('answers a stale version with VERSION_CONFLICT and the version stored now', async () => {
    await patch({ version: 1, displayName: 'First' }).expect(200);

    const response = await patch({ version: 1, displayName: 'Second' }).expect(409);
    expect(response.body).toMatchObject({ error: { code: 'VERSION_CONFLICT', details: { currentVersion: 2 } } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: employee.id } })).displayName).toBe('First');
  });

  it('writes nothing for an unchanged name (Q37)', async () => {
    const response = await patch({ version: 1, displayName: ` ${employee.username} ` }).expect(200);

    expect((response.body as MeDto).version).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: employee.id } })).version).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'USER', action: 'UPDATE' } })).toBe(0);
  });

  it('is refused while the user must still change their password', async () => {
    const fresh = await createUser(app, { username: 'fresh.start', mustChangePassword: true });
    const freshSession = await login(app, fresh.username, fresh.password);

    const response = await patch({ version: 1, displayName: 'Fresh' }, freshSession).expect(403);
    expect(errorCode(response.body)).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fresh.id } })).displayName).toBe('fresh.start');
  });
});
