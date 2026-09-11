import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../auth-context';
import { THROTTLE_SCOPE_METADATA, type ThrottleScopeName } from '../decorators/throttle-scope.decorator';
import { ApiError } from '../errors/api-error';
import { requestPath } from '../http/request-path';

/** Cheap public routes that would otherwise burn the global budget on ordinary page loads. */
const GLOBAL_EXEMPT_PATHS = new Set(['/api/health']);

function pathOf(context: ExecutionContext): string {
  return requestPath(context.switchToHttp().getRequest<Request>());
}

function handlerScope(context: ExecutionContext): ThrottleScopeName | undefined {
  return Reflect.getMetadata(THROTTLE_SCOPE_METADATA, context.getHandler()) as ThrottleScopeName | undefined;
}

/** A named throttler applies only to the handlers that opt in with `@ThrottleScope`. */
function onlyScoped(scope: ThrottleScopeName): (context: ExecutionContext) => boolean {
  return (context) => handlerScope(context) !== scope;
}

/**
 * The throttlers of §6.8.8. Skipping is configured per throttler here, not in the guard:
 * `ThrottlerGuard.shouldSkip` is not told which throttler it is being asked about, so overriding
 * it can only skip all of them or none.
 */
export const THROTTLER_DEFINITIONS: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: 'global',
      limit: 600,
      ttl: 60_000,
      skipIf: (context) => {
        const path = pathOf(context);
        return GLOBAL_EXEMPT_PATHS.has(path) || path.startsWith('/api/uploads/');
      },
    },
    { name: 'login', limit: 60, ttl: 60_000, skipIf: onlyScoped('login') },
    { name: 'refresh', limit: 60, ttl: 60_000, skipIf: onlyScoped('refresh') },
    { name: 'upload', limit: 10, ttl: 60_000, skipIf: onlyScoped('upload') },
  ],
  errorMessage: 'RATE_LIMITED',
};

/**
 * Counts per client address (per user for uploads) and answers `RATE_LIMITED` with `Retry-After`
 * rather than the library's own error shape.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /**
   * `req.auth` is set by AuthGuard, which runs after this guard, so the upload limiter falls back
   * to the address until the uploads module wires its own ordering in M2.
   */
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const { auth } = req as unknown as AuthenticatedRequest;
    return Promise.resolve(auth ? `user:${auth.userId}` : String(req.ip ?? ''));
  }

  /**
   * The library keys counters by controller and handler, which would give every endpoint its own
   * `global` budget — a ceiling that grows with each route added. §6.8.8 means one budget per
   * throttler per client, so the key deliberately ignores the handler.
   */
  protected override generateKey(_context: ExecutionContext, suffix: string, name: string): string {
    return `${name}:${suffix}`;
  }

  protected override throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const retryAfterSeconds = Math.max(1, Math.ceil(detail.timeToBlockExpire));
    context.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(retryAfterSeconds));
    throw new ApiError('RATE_LIMITED', { retryAfterSeconds });
  }
}
