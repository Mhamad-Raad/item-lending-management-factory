import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type {
  AuthTokenDto,
  CustomerDto,
  DriverDto,
  ItemDto,
  OrderDetailDto,
  GrantablePermissionKey,
  PaymentResultDto,
  UserDto,
} from '@pallet/shared';
import { closePermissionSet } from '@pallet/shared';
import ckb from '../src/i18n/locales/ckb.json' with { type: 'json' };
import { LIVE_ADMIN } from './accounts';

export { LIVE_ADMIN };

type Tree = { [key: string]: string | Tree };

/**
 * The Sorani text of an i18n key, straight from the locale file the app ships: the tests find controls by what a
 * factory clerk reads on the screen, and a renamed key fails here instead of silently matching nothing.
 */
export function sorani(key: string, params: Record<string, string | number> = {}): string {
  const found = key
    .split('.')
    .reduce<string | Tree | undefined>(
      (node, part) => (node && typeof node === 'object' ? node[part] : undefined),
      ckb as Tree,
    );
  if (typeof found !== 'string') throw new Error(`no Sorani string for ${key}`);
  return found.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params[name] ?? `{{${name}}}`));
}

/**
 * Tells this run's staged records apart from those of an earlier local run against a reused stack (CI always
 * starts from a reset database): item names carry it, so a search finds exactly one.
 */
export const RUN = Date.now().toString(36).slice(-6);

/**
 * A pattern for an i18n sentence with its parameters filled in: the app wraps typed or numeric values in invisible
 * direction isolates (Q43), which the pattern allows around each value.
 */
export function soraniPattern(key: string, params: Record<string, string | number>): RegExp {
  const marks = '[\\u2066-\\u2069\\u200e\\u200f]*';
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = sorani(key)
    .split(/(\{\{\s*\w+\s*\}\})/)
    .map((part) => {
      const name = /^\{\{\s*(\w+)\s*\}\}$/.exec(part)?.[1];
      return name === undefined ? escape(part) : `${marks}${escape(String(params[name] ?? ''))}${marks}`;
    })
    .join('');
  return new RegExp(source);
}

/** Western digits with thousands separators, as the app writes money and quantities (§7.13). */
export const figure = (value: number): string => value.toLocaleString('en-US');

/** Signs in through the login page as a clerk would, and waits for the app shell. */
export async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(sorani('auth.login.username')).fill(username);
  await page.getByLabel(sorani('auth.login.password'), { exact: true }).fill(password);
  await page.getByRole('button', { name: sorani('auth.login.submit'), exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** The API as a script: signs in as the admin and calls with the headers the web app sends. */
export async function adminApi(request: APIRequestContext) {
  const login = await request.post('/api/auth/login', {
    headers: { 'X-Requested-With': 'pallet-web' },
    data: { username: LIVE_ADMIN.username, password: LIVE_ADMIN.password },
  });
  expect(login.status()).toBe(200);
  const { accessToken } = (await login.json()) as AuthTokenDto;
  const headers = { Authorization: `Bearer ${accessToken}`, 'X-Requested-With': 'pallet-web' };

  const call = async <T>(method: 'GET' | 'POST', path: string, data?: unknown, extra: Record<string, string> = {}) => {
    const response = await request.fetch(path, { method, headers: { ...headers, ...extra }, data });
    if (!response.ok()) throw new Error(`${method} ${path} → ${response.status()} ${await response.text()}`);
    return (await response.json()) as T;
  };

  return {
    get: <T>(path: string) => call<T>('GET', path),
    post: <T>(path: string, data: unknown, extra?: Record<string, string>) => call<T>('POST', path, data, extra),
    /** A new employee, who must change the password on first sign-in (§4.1); each key brings its dependencies. */
    createEmployee: (username: string, password: string, permissions: GrantablePermissionKey[]) =>
      call<UserDto>('POST', '/api/users', {
        username,
        displayName: username,
        role: 'EMPLOYEE',
        password,
        permissions: [...closePermissionSet(permissions)],
      }),
  };
}

/** Today in Baghdad, as the API dates business records (§4.7). */
export const today = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/** dd/MM/yyyy, as every screen and the receipt show a date (§7.13). */
export const shown = (date: string): string => date.split('-').reverse().join('/');

type Api = Awaited<ReturnType<typeof adminApi>>;

/** A phone number no seeded customer or driver holds, so no duplicate-phone warning interrupts a flow. */
const freshPhone = (): string => `0750${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;

/**
 * Stages the records a flow needs through the API, each test with its own: the demo seed is dated from today, so
 * its figures move with the calendar, and one test's orders must not shift another's stock or totals.
 */
export function stage(api: Api) {
  return {
    customer: (name: string) =>
      api.post<CustomerDto>('/api/customers', {
        name,
        phone: freshPhone(),
        address: 'هەولێر، شەقامی 100 مەتری',
        creditLimit: null,
      }),
    driver: (name: string) =>
      api.post<DriverDto>('/api/drivers', { name, phone: freshPhone(), carNumber: '22 A 12345' }),
    item: (name: string, depositPrice: number, stock: number) =>
      api.post<ItemDto>('/api/items', {
        name,
        depositPrice,
        minStock: null,
        initialBatch: { date: today(), quantity: stock, unitCost: Math.round(depositPrice / 2) },
      }),
    order: (body: {
      customerId: number;
      driverId: number;
      paymentType: 'CASH' | 'LENT';
      lines: { itemId: number; quantity: number }[];
    }) =>
      api.post<OrderDetailDto>('/api/orders', { date: today(), ...body }, { 'Idempotency-Key': crypto.randomUUID() }),
    payment: (orderId: number, amount: number) =>
      api.post<PaymentResultDto>(
        `/api/orders/${orderId}/payments`,
        { date: today(), amount },
        { 'Idempotency-Key': crypto.randomUUID() },
      ),
  };
}
