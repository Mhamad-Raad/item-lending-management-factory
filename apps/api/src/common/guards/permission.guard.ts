import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext, AuthenticatedRequest } from '../auth-context';
import { getAccessRules, type AccessRule } from '../decorators/access.decorators';
import { ApiError } from '../errors/api-error';

/**
 * Enforces the handler's single access declaration. Admins hold every key implicitly, so only the
 * employee paths consult the stored set (§6.4.1).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const [rule] = getAccessRules(context.getHandler());
    if (!rule || rule.kind === 'public' || rule.kind === 'authenticated') return true;

    const req = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const auth = req.auth;
    if (!auth) throw new ApiError('AUTH_REQUIRED');
    if (auth.isAdmin) return true;
    if (rule.kind === 'adminOnly') throw new ApiError('ADMIN_ONLY');

    if (!this.holds(auth, rule)) throw new ApiError('PERMISSION_DENIED');
    return true;
  }

  private holds(auth: AuthContext, rule: Extract<AccessRule, { kind: 'all' | 'any' }>): boolean {
    return rule.kind === 'all'
      ? rule.keys.every((key) => auth.permissions.has(key))
      : rule.keys.some((key) => auth.permissions.has(key));
  }
}
