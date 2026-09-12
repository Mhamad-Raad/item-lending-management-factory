import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import { asUser, type Session } from './auth';

const FILL = { r: 200, g: 120, b: 40 };

/** A plain PNG of the given size: enough for every decoder, resizer and header check. */
export function pngImage(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: FILL } })
    .png()
    .toBuffer();
}

/** A JPEG carrying EXIF — the metadata a phone photo leaks: owner, place, device. */
export function jpegWithExif(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: FILL } })
    .jpeg()
    .withExif({ IFD0: { ImageDescription: 'warehouse, gps 36.19 44.01' } })
    .toBuffer();
}

/** `POST /api/uploads?kind=…` with one file part named `file`, as the web app sends it. */
export function uploadImage(
  app: INestApplication,
  session: Session,
  kind: string,
  file: Buffer,
  fileName = 'image.png',
): request.Test {
  return request(app.getHttpServer())
    .post(`/api/uploads?kind=${kind}`)
    .set(asUser(session))
    .attach('file', file, fileName);
}

/** Collects a binary response body, which supertest would otherwise try to read as text. */
export function binaryBody(res: unknown, callback: (error: Error | null, body: Buffer) => void): void {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}
