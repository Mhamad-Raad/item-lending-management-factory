import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth-context';
import { ApiError } from '../../common/errors/api-error';
import { rateLimited } from '../../common/guards/app-throttler.guard';

/** §6.8.8: ten uploads per user per minute. */
export const UPLOAD_LIMIT = 10;
export const UPLOAD_WINDOW_MS = 60_000;

/**
 * The `upload` throttler counts per user, and the user is known only once `AuthGuard` has run —
 * after the global throttler. So this limit is a route guard, which Nest runs after every global
 * guard, counting in the same in-memory storage as the other throttlers.
 */
@Injectable()
export class UploadThrottleGuard implements CanActivate {
  constructor(@InjectThrottlerStorage() private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const userId = http.getRequest<Request & AuthenticatedRequest>().auth?.userId;
    // Unreachable through the global chain, which refuses an anonymous request before this runs.
    if (userId === undefined) throw new ApiError('AUTH_REQUIRED');

    const record = await this.storage.increment(
      `upload:user:${userId}`,
      UPLOAD_WINDOW_MS,
      UPLOAD_LIMIT,
      UPLOAD_WINDOW_MS,
      'upload',
    );
    if (record.isBlocked) throw rateLimited(http.getResponse<Response>(), record.timeToBlockExpire);
    return true;
  }
}
