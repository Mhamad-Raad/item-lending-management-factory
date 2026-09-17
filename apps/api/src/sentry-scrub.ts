import type { ErrorEvent } from '@sentry/nestjs';

/** Request headers an error report never carries: credentials, and the caller's address behind the proxy. */
const DROPPED_HEADERS = ['authorization', 'cookie', 'x-forwarded-for', 'x-real-ip', 'forwarded'] as const;

/**
 * What an error report may carry (§10.6 D9): no cookies, body or credentials, no query string — a list search is a
 * customer's name or phone — and no client address (`sendDefaultPii: false` covers `user.ip_address`, not the
 * forwarding headers Caddy adds). The path stays, to say which endpoint failed.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const request = event.request;
  if (!request) return event;
  delete request.cookies;
  delete request.data;
  delete request.query_string;
  if (request.url) request.url = request.url.split('?')[0];
  if (request.headers) {
    for (const name of Object.keys(request.headers)) {
      if ((DROPPED_HEADERS as readonly string[]).includes(name.toLowerCase())) delete request.headers[name];
    }
  }
  return event;
}
