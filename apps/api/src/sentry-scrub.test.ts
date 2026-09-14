import type { ErrorEvent } from '@sentry/nestjs';
import { describe, expect, it } from 'vitest';
import { scrubEvent } from './sentry-scrub';

/** §10.6 D9: an error report carries no personal data — a search term is a customer's name or phone. */
describe('scrubEvent', () => {
  it('drops cookies, body, credentials and the query string, and keeps the path', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://pallets.example/api/customers?search=Karwan%20Aziz&page=2',
        query_string: 'search=Karwan%20Aziz&page=2',
        cookies: { pallet_rt: 'secret' },
        data: '{"password":"x"}',
        headers: { authorization: 'Bearer abc', cookie: 'pallet_rt=secret', 'user-agent': 'Chrome' },
      },
    } as ErrorEvent);

    expect(event.request).toEqual({
      url: 'https://pallets.example/api/customers',
      headers: { 'user-agent': 'Chrome' },
    });
  });
});
