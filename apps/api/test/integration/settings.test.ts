import type { INestApplication } from '@nestjs/common';
import { GRANTABLE_PERMISSION_KEYS, type SettingsDto, type UploadDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UploadThrottleGuard } from '../../src/modules/uploads/upload-throttle.guard';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { EMPLOYEE_PASSWORD, createEmployee } from '../helpers/factories';
import { pngImage, uploadImage } from '../helpers/images';

/** What `resetDatabase` seeds, as the form would send it back. */
const SEEDED = { version: 1, factoryName: 'Pallet Factory', phone: '-', address: '-', logoUploadId: null };

describe('factory settings', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;

  beforeAll(async () => {
    app = await createTestApp({
      customise: (builder) => builder.overrideGuard(UploadThrottleGuard).useValue({ canActivate: () => true }),
    });
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

  const put = (session: Session, body: Record<string, unknown>): request.Test =>
    request(app.getHttpServer()).put('/api/settings').set(asUser(session)).send(body);

  it('is readable by anyone signed in: every receipt is headed by it', async () => {
    const employee = await createEmployee(app, [], 'reader');
    const session = await login(app, employee.username, EMPLOYEE_PASSWORD);

    const response = await request(app.getHttpServer()).get('/api/settings').set(asUser(session)).expect(200);

    expect(response.body).toMatchObject({ ...SEEDED, logoUrl: null });
  });

  it('is changed by an admin, recording only the fields that changed', async () => {
    const response = await put(admin, { ...SEEDED, factoryName: 'کارگەی پالێتی هەولێر', phone: '07501234567' }).expect(
      200,
    );
    expect(response.body).toMatchObject({
      factoryName: 'کارگەی پالێتی هەولێر',
      phone: '07501234567',
      address: '-',
      version: 2,
    });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'SETTINGS_CHANGE' } });
    expect(audit).toMatchObject({ entityType: 'SETTINGS', entityId: '1' });
    expect(audit.summaryParams).toEqual({ fields: ['factoryName', 'phone'] });
    expect(audit.before).toEqual({ factoryName: 'Pallet Factory', phone: '-' });
    expect(audit.after).toEqual({ factoryName: 'کارگەی پالێتی هەولێر', phone: '07501234567' });
  });

  it('treats saving an unchanged form as a no-op (Q36)', async () => {
    const response = await put(admin, SEEDED).expect(200);

    expect((response.body as SettingsDto).version).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'SETTINGS_CHANGE' } })).toBe(0);
  });

  it('refuses a stale version, even when the form would change nothing', async () => {
    await put(admin, { ...SEEDED, address: 'هەولێر' }).expect(200);

    const stale = await put(admin, SEEDED).expect(409);

    expect(stale.body).toMatchObject({ error: { code: 'VERSION_CONFLICT', details: { currentVersion: 2 } } });
  });

  it('accepts only a factory-logo upload as the logo', async () => {
    const image = await pngImage(300, 100);
    const itemImage = (await uploadImage(app, admin, 'ITEM_IMAGE', image).expect(201)).body as UploadDto;

    const wrongKind = await put(admin, { ...SEEDED, logoUploadId: itemImage.id }).expect(400);
    expect(wrongKind.body).toMatchObject({
      error: { code: 'UPLOAD_KIND_MISMATCH', details: { expected: 'FACTORY_LOGO', actual: 'ITEM_IMAGE' } },
    });

    const missing = await put(admin, { ...SEEDED, logoUploadId: 999_999 }).expect(404);
    expect(missing.body).toMatchObject({ error: { code: 'UPLOAD_NOT_FOUND', details: { uploadId: 999_999 } } });

    const logo = (await uploadImage(app, admin, 'FACTORY_LOGO', image).expect(201)).body as UploadDto;
    const saved = await put(admin, { ...SEEDED, logoUploadId: logo.id }).expect(200);
    expect(saved.body).toMatchObject({ logoUploadId: logo.id, logoUrl: logo.url, version: 2 });
  });

  it('S-13: is not editable by an employee holding every grantable permission', async () => {
    const employee = await createEmployee(app, GRANTABLE_PERMISSION_KEYS, 'everything');
    const session = await login(app, employee.username, EMPLOYEE_PASSWORD);

    const refused = await put(session, SEEDED).expect(403);

    expect(refused.body).toMatchObject({ error: { code: 'ADMIN_ONLY' } });
  });

  it('refuses a name that is empty once trimmed', async () => {
    const refused = await put(admin, { ...SEEDED, factoryName: '   ' }).expect(400);

    expect(refused.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', fields: [{ path: 'factoryName', code: 'too_short' }] },
    });
  });
});
