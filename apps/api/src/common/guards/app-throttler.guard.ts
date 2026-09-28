import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Clock } from '../clock';
import { getAccessRules } from '../decorators/access.decorators';
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
 * The throttlers of §6.8.8 (`global` counts per user once signed in, Q124). Skipping is configured per
 * throttler here, not in the guard: `ThrottlerGuard.shouldSkip` is not told which throttler it is being
 * asked about, so overriding it can only skip all of them or none. The per-user `upload` limit needs the
 * authenticated user, so it is a route guard of its own, `UploadThrottleGuard`, counting in the same storage.
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

/**
 * Counts per client address — or, for `global` on a signed-in route, per user (Q124) — and answers in the
 * API's own error shape, never the library's.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly clock: Clock,
  ) {
    super(options, storage, reflector);
  }

  /**
   * The library keys counters by controller and handler, which would give every endpoint its own
   * `global` budget — a ceiling that grows with each route added. §6.8.8 means one budget per
   * throttler per client, so the key deliberately ignores the handler.
   *
   * The whole factory reaches the server from one public address, so a per-address `global` budget is
   * shared by every device there (Q124). On a route that needs a signed-in user, a request carrying a
   * valid access token counts against that user instead. Public routes — login, refresh, logout, health —
   * and the `login` / `refresh` throttlers stay per address, and a missing or invalid token falls back to the
   * address (the authentication guard then refuses it anyway).
   */
  protected override generateKey(context: ExecutionContext, suffix: string, name: string): string {
    const userId = name === 'global' ? this.signedInUser(context) : null;
    return userId === null ? `${name}:${suffix}` : `${name}:user:${userId}`;
  }

  /** The user id of a valid access token on a non-public route, or null. Its signature proves it was issued. */
  private signedInUser(context: ExecutionContext): string | null {
    const [rule] = getAccessRules(context.getHandler());
    if (!rule || rule.kind === 'public') return null;
    const header = context.switchToHttp().getRequest<Request>().headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      const { sub } = this.jwt.verify<{ sub?: unknown }>(header.slice('Bearer '.length), {
        algorithms: ['HS256'],
        clockTimestamp: Math.floor(this.clock.now().getTime() / 1000),
      });
      return typeof sub === 'string' && /^\d+$/.test(sub) ? sub : null;
    } catch {
      return null;
    }
  }

  protected override throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    throw rateLimited(context.switchToHttp().getResponse<Response>(), detail.timeToBlockExpire);
  }
}
