import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../errors/api-error';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REQUIRED_HEADER = 'x-requested-with';
const REQUIRED_VALUE = 'pallet-web';

/**
 * The refresh cookie is `SameSite=Strict`, and this header cannot be set cross-origin without a
 * preflight the API never answers — together they make a state-changing request forgeable only
 * from the app's own origin (§10.1 S16). Applies to the public auth routes too.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!STATE_CHANGING_METHODS.has(req.method)) return true;
    if (req.headers[REQUIRED_HEADER] === REQUIRED_VALUE) return true;
    throw new ApiError('CSRF_HEADER_MISSING');
  }
}
