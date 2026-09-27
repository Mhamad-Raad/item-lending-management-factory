import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@pallet/shared';
import { captureException } from '@sentry/nestjs';
import type { Request, Response } from 'express';
import { JSON_BODY_LIMIT_BYTES } from '../../bootstrap';
import { ApiError } from '../errors/api-error';
import { isDatabaseUnavailable } from '../errors/prisma-errors';

/**
 * What body-parser throws before a request reaches any handler: a plain error carrying an HTTP
 * status and a `type`, not a Nest `HttpException`. Left unrecognised it would be a 500.
 */
interface BodyParserError {
  status: number;
  type: string;
}

function isBodyParserError(exception: unknown): exception is BodyParserError {
  const candidate = exception as Partial<BodyParserError> | null;
  return typeof candidate?.status === 'number' && typeof candidate.type === 'string';
}

/** Maps every thrown error to `{ error: { code, details?, fields? }, requestId }` (§6.3.1). */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const requestId = String(req.id ?? '');

    let status: number;
    let error: ApiErrorBody['error'];

    if (exception instanceof ApiError) {
      status = exception.status;
      error = { code: exception.code };
      if (exception.details) error.details = exception.details;
      if (exception.fields) error.fields = exception.fields;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      error = { code: httpStatusToCode(status) };
    } else if (isBodyParserError(exception)) {
      status = exception.status;
      error = bodyParserErrorToBody(exception);
    } else if (isDatabaseUnavailable(exception)) {
      // The database is down, restarting or out of connections: a condition of the moment the client
      // may retry, not a bug (Q82).
      status = 503;
      error = { code: 'SERVICE_UNAVAILABLE' };
      this.logger.warn(`database unavailable: ${describe(exception)}`);
    } else {
      status = 500;
      error = { code: 'INTERNAL_ERROR' };
      this.logger.error(exception);
    }

    // Server errors only (§10.6 D9); a no-op unless `instrument.ts` initialised Sentry. An outage is
    // reported once per kind as a warning, grouped under one issue, rather than as a new bug per request.
    if (status === 503) {
      captureException(exception, { level: 'warning', fingerprint: ['service-unavailable'] });
    } else if (status >= 500) {
      captureException(exception);
    }

    const body: ApiErrorBody = { error, requestId };
    res.status(status).json(body);
  }
}

function bodyParserErrorToBody(exception: BodyParserError): ApiErrorBody['error'] {
  if (exception.type === 'entity.too.large') {
    return { code: 'PAYLOAD_TOO_LARGE', details: { maxBytes: JSON_BODY_LIMIT_BYTES } };
  }
  // Malformed JSON, a wrong charset, an aborted stream: the client sent something unreadable.
  return { code: httpStatusToCode(exception.status) };
}

/** The error's class and code, without its message: a driver message can quote SQL or a connection string. */
function describe(exception: unknown): string {
  const { name, code } = (exception ?? {}) as { name?: unknown; code?: unknown };
  return [typeof name === 'string' ? name : 'Error', typeof code === 'string' ? code : null].filter(Boolean).join(' ');
}

function httpStatusToCode(status: number): ErrorCode {
  switch (status) {
    case 503:
      return 'SERVICE_UNAVAILABLE';
    case 404:
      return 'ROUTE_NOT_FOUND';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 429:
      return 'RATE_LIMITED';
    case 400:
      return 'VALIDATION_FAILED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED';
  }
}
