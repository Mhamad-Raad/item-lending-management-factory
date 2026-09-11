import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext, AuthenticatedRequest } from '../auth-context';

/**
 * The caller, as loaded by AuthGuard. Only valid on routes that are not `@Public()`; a public
 * handler that asks for it gets undefined rather than a stale user.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext | undefined => {
  return ctx.switchToHttp().getRequest<Request & AuthenticatedRequest>().auth;
});
