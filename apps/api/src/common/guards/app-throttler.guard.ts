import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request, Response } from 'express';
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
 * The per-address throttlers of §6.8.8. Skipping is configured per throttler here, not in the guard:
 * `ThrottlerGuard.shouldSkip` is not told which throttler it is being asked about, so overriding
 * it can only skip all of them or none. The per-user `upload` limit needs the authenticated user,
 * so it is a route guard of its own, `UploadThrottleGuard`, counting in the same storage.
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
  ],
  errorMessage: 'RATE_LIMITED',
};

/** The one shape of a rate-limit refusal: `Retry-After` and `RATE_LIMITED { retryAfterSeconds }`. */
export function rateLimited(res: Response, secondsLeft: number): ApiError {
  const retryAfterSeconds = Math.max(1, Math.ceil(secondsLeft));
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return new ApiError('RATE_LIMITED', { retryAfterSeconds });
}

/** Counts per client address and answers in the API's own error shape, never the library's. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /**
   * The library keys counters by controller and handler, which would give every endpoint its own
   * `global` budget — a ceiling that grows with each route added. §6.8.8 means one budget per
   * throttler per client, so the key deliberately ignores the handler.
   */
  protected override generateKey(_context: ExecutionContext, suffix: string, name: string): string {
    return `${name}:${suffix}`;
  }

  protected override throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    throw rateLimited(context.switchToHttp().getResponse<Response>(), detail.timeToBlockExpire);
  }
}
