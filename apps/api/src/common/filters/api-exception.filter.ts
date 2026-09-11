import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@pallet/shared';
import type { Request, Response } from 'express';
import { ApiError } from '../errors/api-error';

/** Maps every thrown error to `{ error: { code, details?, fields? }, requestId }`. */
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
    } else {
      status = 500;
      error = { code: 'INTERNAL_ERROR' };
      this.logger.error(exception);
    }

    const body: ApiErrorBody = { error, requestId };
    res.status(status).json(body);
  }
}

function httpStatusToCode(status: number): ErrorCode {
  switch (status) {
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
