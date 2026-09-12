import type { INestApplication } from '@nestjs/common';
import type { UploadDto } from '@pallet/shared';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UploadThrottleGuard } from '../../src/modules/uploads/upload-throttle.guard';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { EMPLOYEE_PASSWORD, createEmployee } from '../helpers/factories';
import { binaryBody, jpegWithExif, pngImage, uploadImage } from '../helpers/images';

function errorCode(body: unknown): string | undefined {
  return (body as { error?: { code?: string } }).error?.code;
}

describe('uploads', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;

  beforeAll(async () => {
    app = await createTestApp({
      // The per-user budget of ten a minute has its own file; across these cases it would run out.
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

  const fetchImage = (url: string): request.Test =>
    request(app.getHttpServer()).get(url).buffer(true).parse(binaryBody);

  it('S-19: stores an image as WebP and serves it with the security headers', async () => {
    const response = await uploadImage(app, admin, 'ITEM_IMAGE', await pngImage(400, 300)).expect(201);
    const upload = response.body as UploadDto;
    expect(upload).toMatchObject({ kind: 'ITEM_IMAGE', width: 400, height: 300 });
    expect(upload.url).toMatch(/^\/api\/uploads\/[0-9a-f]{32}\.webp$/);

    // No Authorization header: an <img> cannot send one.
    const served = await fetchImage(upload.url).expect(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toBe("default-src 'none'");
    expect((await sharp(served.body as Buffer).metadata()).format).toBe('webp');

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'UPLOAD_CREATE' } });
    expect(audit).toMatchObject({ entityType: 'UPLOAD', entityId: String(upload.id) });
    expect(audit.summaryParams).toEqual({ kind: 'ITEM_IMAGE', width: 400, height: 300 });
  });

  it('S-19: drops EXIF and every other piece of metadata', async () => {
    const photo = await jpegWithExif(640, 480);
    expect((await sharp(photo).metadata()).exif).toBeDefined();

    const upload = (await uploadImage(app, admin, 'ITEM_IMAGE', photo, 'photo.jpg').expect(201)).body as UploadDto;
    const served = await fetchImage(upload.url).expect(200);

    expect((await sharp(served.body as Buffer).metadata()).exif).toBeUndefined();
  });

  it('shrinks to 1600 px for an item and 800 px for the logo, and never enlarges (Q35)', async () => {
    const wide = await pngImage(3200, 1600);

    expect((await uploadImage(app, admin, 'ITEM_IMAGE', wide).expect(201)).body).toMatchObject({
      width: 1600,
      height: 800,
    });
    expect((await uploadImage(app, admin, 'FACTORY_LOGO', wide).expect(201)).body).toMatchObject({
      width: 800,
      height: 400,
    });
    expect((await uploadImage(app, admin, 'ITEM_IMAGE', await pngImage(120, 80)).expect(201)).body).toMatchObject({
      width: 120,
      height: 80,
    });
  });

  it('S-19: judges the type by content, never by the name', async () => {
    const text = Buffer.from('plain text wearing an image name');
    const renamed = await uploadImage(app, admin, 'ITEM_IMAGE', text, 'fake.png').expect(415);
    expect(renamed.body).toMatchObject({
      error: { code: 'UPLOAD_TYPE_NOT_ALLOWED', details: { allowed: ['image/png', 'image/jpeg', 'image/webp'] } },
    });

    // The right first bytes, but nothing a decoder can read behind them.
    const forged = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not an image at all'),
    ]);
    expect(errorCode((await uploadImage(app, admin, 'ITEM_IMAGE', forged).expect(400)).body)).toBe(
      'UPLOAD_INVALID_IMAGE',
    );
  });

  it('S-19: refuses a file over 5 MiB with 413', async () => {
    const huge = Buffer.alloc(6 * 1024 * 1024, 7);

    const refused = await uploadImage(app, admin, 'ITEM_IMAGE', huge).expect(413);

    expect(refused.body).toMatchObject({ error: { code: 'UPLOAD_TOO_LARGE', details: { maxBytes: 5_242_880 } } });
  });

  it('wants exactly one file part named `file`, and the kind in the query (Q35)', async () => {
    const image = await pngImage(10, 10);
    const post = (): request.Test =>
      request(app.getHttpServer()).post('/api/uploads?kind=ITEM_IMAGE').set(asUser(admin));

    expect(errorCode((await post().expect(400)).body)).toBe('UPLOAD_MISSING_FILE');
    expect(errorCode((await post().attach('image', image, 'a.png').expect(400)).body)).toBe('UPLOAD_MISSING_FILE');
    expect(errorCode((await post().field('note', 'hello').attach('file', image, 'a.png').expect(400)).body)).toBe(
      'VALIDATION_FAILED',
    );

    const badKind = await uploadImage(app, admin, 'AVATAR', image).expect(400);
    expect(badKind.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', fields: [{ path: 'kind' }] } });
  });

  it('S-13: lets whoever may add or edit items upload an item image, and only an admin the logo', async () => {
    const image = await pngImage(20, 20);
    const editor = await createEmployee(app, ['items.view', 'items.edit'], 'item.editor');
    const editorSession = await login(app, editor.username, EMPLOYEE_PASSWORD);

    await uploadImage(app, editorSession, 'ITEM_IMAGE', image).expect(201);
    expect(errorCode((await uploadImage(app, editorSession, 'FACTORY_LOGO', image).expect(403)).body)).toBe(
      'ADMIN_ONLY',
    );

    const viewer = await createEmployee(app, ['items.view'], 'item.viewer');
    const viewerSession = await login(app, viewer.username, EMPLOYEE_PASSWORD);
    expect(errorCode((await uploadImage(app, viewerSession, 'ITEM_IMAGE', image).expect(403)).body)).toBe(
      'PERMISSION_DENIED',
    );
  });

  it('S-19: serves only well-formed names, and every miss is the same 404', async () => {
    const paths = [
      '/api/uploads/..%2f.env',
      '/api/uploads/..%2F..%2Fpackage.json',
      '/api/uploads/not-a-name.webp',
      `/api/uploads/${'a'.repeat(32)}.webp`,
    ];

    for (const path of paths) {
      const response = await request(app.getHttpServer()).get(path);
      expect([path, response.status, errorCode(response.body)]).toEqual([path, 404, 'NOT_FOUND']);
    }
  });
});
