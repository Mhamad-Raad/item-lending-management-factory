import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth-context';
import { ApiError } from '../errors/api-error';
import { requestPath } from '../http/request-path';

/** The only routes a user with `mustChangePassword` may still call (§6.8.7). */
const ALLOWED_PATHS = new Set([
  'GET /api/auth/me',
  'POST /api/auth/change-password',
  'POST /api/auth/logout',
  'POST /api/auth/logout-all',
  'POST /api/auth/refresh',
]);

/**
 * A seeded or reset account must set its own password before it can do anything else; until then
 * every other route answers `PASSWORD_CHANGE_REQUIRED` and the web app redirects.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    if (!req.auth?.mustChangePassword) return true;
    if (ALLOWED_PATHS.has(`${req.method} ${requestPath(req)}`)) return true;
    throw new ApiError('PASSWORD_CHANGE_REQUIRED');
  }
}
