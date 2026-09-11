import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

/**
 * Opens the AsyncLocalStorage scope for one request. Registered after the pino-http
 * middleware, so `req.id` (the request id echoed as `X-Request-Id`) is already assigned.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const { id } = req as Request & { id?: unknown };
    RequestContext.run({ requestId: typeof id === 'string' ? id : '', ip: req.ip ?? '', userId: null }, next);
  }
}
