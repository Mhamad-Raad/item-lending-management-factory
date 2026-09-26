import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/nestjs';

/** Request headers an error report never carries: credentials, and the caller's address behind the proxy. */
const DROPPED_HEADERS = ['authorization', 'cookie', 'x-forwarded-for', 'x-real-ip', 'forwarded'] as const;

/**
 * Exceptions whose message can quote the data of the failing statement: Prisma's validation errors print the
 * arguments of the call (a customer's name and phone), and PostgreSQL's constraint errors the key that clashed
 * (`Key (phone)=(0750…)`). Their message is replaced by the error's type and code.
 */
const DATA_QUOTING_ERROR = /^(PrismaClient\w*Error|DriverAdapterError|DatabaseError)$/;

/**
 * What an error report may carry (§10.6 D9, Q75): no cookies, body or credentials, no query string — a list
 * search is a customer's name or phone — no client address (`sendDefaultPii: false` covers `user.ip_address`, not
 * the forwarding headers Caddy adds), no breadcrumb messages or data (console lines and outgoing requests can
 * quote anything), and no database error text. The path stays, to say which endpoint failed, and so do the
 * stack traces.
 */
export function scrubEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent {
  scrubRequest(event);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  scrubDatabaseErrors(event, hint);
  return event;
}

function scrubRequest(event: ErrorEvent): void {
  const request = event.request;
  if (!request) return;
  delete request.cookies;
  delete request.data;
  delete request.query_string;
  if (request.url) request.url = withoutQuery(request.url);
  if (request.headers) {
    for (const name of Object.keys(request.headers)) {
      if ((DROPPED_HEADERS as readonly string[]).includes(name.toLowerCase())) delete request.headers[name];
    }
  }
}

/**
 * A breadcrumb keeps what happened and when; an outgoing HTTP call also keeps its method, path and status,
 * which is what makes it useful. Everything free-form goes.
 */
function scrubBreadcrumb({ type, category, level, timestamp, data }: Breadcrumb): Breadcrumb {
  const kept: Breadcrumb = { type, category, level, timestamp };
  if (category === 'http' && data) {
    const { method, status_code: statusCode, url } = data as Record<string, unknown>;
    kept.data = {
      ...(typeof method === 'string' ? { method } : {}),
      ...(typeof statusCode === 'number' ? { status_code: statusCode } : {}),
      ...(typeof url === 'string' ? { url: withoutQuery(url) } : {}),
    };
  }
  return Object.fromEntries(Object.entries(kept).filter(([, value]) => value !== undefined)) as Breadcrumb;
}

function scrubDatabaseErrors(event: ErrorEvent, hint: EventHint | undefined): void {
  const original = hint?.originalException as { code?: unknown } | undefined;
  const code = typeof original?.code === 'string' ? original.code : undefined;
  for (const exception of event.exception?.values ?? []) {
    if (exception.type && DATA_QUOTING_ERROR.test(exception.type)) {
      exception.value = code ? `${exception.type} ${code}` : exception.type;
    }
  }
}

function withoutQuery(url: string): string {
  return url.split('?')[0] ?? url;
}
