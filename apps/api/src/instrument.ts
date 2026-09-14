import * as Sentry from '@sentry/nestjs';
import { scrubEvent } from './sentry-scrub';

/**
 * API error alerting (§10.6 D9), imported by `main.ts` before anything else so Sentry can wrap what loads after it.
 * Active only when `SENTRY_DSN` is set; `ApiExceptionFilter` reports 5xx errors. No personal data leaves: no default
 * PII, and `scrubEvent` drops the request's cookies, body, credentials and query string from every event.
 */
const dsn = process.env.SENTRY_DSN?.trim();
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || 'production',
    release: process.env.APP_VERSION?.trim() || 'dev',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
}
