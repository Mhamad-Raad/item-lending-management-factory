import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TEST_ADMIN } from './db';

export interface Session {
  accessToken: string;
  /** The `pallet_rt` cookie as sent back by the API. */
  cookie: string;
}

/** Every state-changing request needs it; a test about CSRF sends its own headers instead. */
export const CSRF_HEADER = { 'X-Requested-With': 'pallet-web' } as const;

export function refreshCookie(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : [header];
  const cookie = cookies.find((value: string | undefined) => value?.startsWith('pallet_rt='));
  if (!cookie) throw new Error('response carries no pallet_rt cookie');
  return cookie.split(';')[0] ?? '';
}

export async function login(
  app: INestApplication,
  username: string = TEST_ADMIN.username,
  password: string = TEST_ADMIN.password,
  headers: Record<string, string> = {},
): Promise<Session> {
  const response = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set(CSRF_HEADER)
    .set(headers)
    .send({ username, password })
    .expect(200);

  return { accessToken: (response.body as { accessToken: string }).accessToken, cookie: refreshCookie(response) };
}

/** `Authorization` plus the CSRF header, the combination nearly every request needs. */
export function asUser(session: Pick<Session, 'accessToken'>): Record<string, string> {
  return { Authorization: `Bearer ${session.accessToken}`, ...CSRF_HEADER };
}
