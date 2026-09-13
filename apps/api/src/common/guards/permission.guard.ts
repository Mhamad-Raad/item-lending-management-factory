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

    const required = this.missing(auth, rule);
    if (required.length > 0) throw new ApiError('PERMISSION_DENIED', { required });
    return true;
  }

  /**
   * The keys a denial names (§6.3 error table): for "all of", the ones the employee still lacks; for
   * "any of", every key that would do. Empty when the rule is satisfied.
   */
  private missing(auth: AuthContext, rule: Extract<AccessRule, { kind: 'all' | 'any' }>): string[] {
    if (rule.kind === 'all') return rule.keys.filter((key) => !auth.permissions.has(key));
    return rule.keys.some((key) => auth.permissions.has(key)) ? [] : [...rule.keys];
  }
}
