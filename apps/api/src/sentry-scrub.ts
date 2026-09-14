import type { ErrorEvent } from '@sentry/nestjs';

/**
 * What an error report may carry (§10.6 D9): no cookies, body or credentials, and no query string — a list search is a
 * customer's name or phone. The path stays, to say which endpoint failed.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const request = event.request;
  if (!request) return event;
  delete request.cookies;
  delete request.data;
  delete request.query_string;
  if (request.url) request.url = request.url.split('?')[0];
  if (request.headers) {
    delete request.headers.authorization;
    delete request.headers.cookie;
  }
  return event;
}
