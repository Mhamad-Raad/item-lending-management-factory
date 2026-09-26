import type { ErrorEvent } from '@sentry/nestjs';
import { describe, expect, it } from 'vitest';
import { scrubEvent } from './sentry-scrub';

/** §10.6 D9: an error report carries no personal data — a search term is a customer's name or phone. */
describe('scrubEvent', () => {
  it('drops cookies, body, credentials, the client address and the query string, and keeps the path', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://pallets.example/api/customers?search=Karwan%20Aziz&page=2',
        query_string: 'search=Karwan%20Aziz&page=2',
        cookies: { pallet_rt: 'secret' },
        data: '{"password":"x"}',
        headers: {
          authorization: 'Bearer abc',
          cookie: 'pallet_rt=secret',
          'X-Forwarded-For': '203.0.113.7',
          'x-real-ip': '203.0.113.7',
          forwarded: 'for=203.0.113.7',
          'user-agent': 'Chrome',
        },
      },
    } as ErrorEvent);

    expect(event.request).toEqual({
      url: 'https://pallets.example/api/customers',
      headers: { 'user-agent': 'Chrome' },
    });
  });
});

describe('scrubEvent: breadcrumbs and database errors (Q75)', () => {
  it('keeps only what and when of a breadcrumb, and the method, path and status of an HTTP call', () => {
    const event = scrubEvent({
      type: undefined,
      breadcrumbs: [
        {
          category: 'console',
          level: 'log',
          timestamp: 1,
          message: 'saving customer Karwan Aziz 07501234567',
          data: { arguments: ['Karwan Aziz'] },
        },
        {
          type: 'http',
          category: 'http',
          timestamp: 2,
          data: {
            method: 'GET',
            status_code: 500,
            url: 'https://hc-ping.com/abc?name=Karwan',
            'http.query': '?name=Karwan',
          },
        },
      ],
    } as ErrorEvent);

    expect(event.breadcrumbs).toEqual([
      { category: 'console', level: 'log', timestamp: 1 },
      {
        type: 'http',
        category: 'http',
        timestamp: 2,
        data: { method: 'GET', status_code: 500, url: 'https://hc-ping.com/abc' },
      },
    ]);
  });

  it('replaces a Prisma or PostgreSQL message, which can quote the data, with the error type and code', () => {
    const quoted = 'Unique constraint failed: Key (phone)=(07501234567) already exists.';
    const event = scrubEvent(
      {
        type: undefined,
        exception: {
          values: [
            { type: 'PrismaClientKnownRequestError', value: quoted },
            { type: 'PrismaClientValidationError', value: 'Invalid `prisma.customer.create()`: { name: "Karwan" }' },
            { type: 'DatabaseError', value: quoted },
            { type: 'LedgerInvariantError', value: 'owed < 0 on order 42' },
          ],
        },
      } as ErrorEvent,
      { originalException: Object.assign(new Error(quoted), { code: 'P2002' }) },
    );

    expect(event.exception?.values?.map((value) => value.value)).toEqual([
      'PrismaClientKnownRequestError P2002',
      'PrismaClientValidationError P2002',
      'DatabaseError P2002',
      // Our own errors carry ids and codes, never personal data: they stay readable.
      'owed < 0 on order 42',
    ]);
    expect(JSON.stringify(event)).not.toContain('07501234567');
  });

  it('names the type alone when the error has no code', () => {
    const event = scrubEvent({
      type: undefined,
      exception: { values: [{ type: 'PrismaClientValidationError', value: 'Argument name: "Karwan"' }] },
    } as ErrorEvent);
    expect(event.exception?.values?.[0]?.value).toBe('PrismaClientValidationError');
  });
});
