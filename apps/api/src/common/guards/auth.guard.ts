import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PERMISSION_KEYS, type PermissionKey } from '@pallet/shared';
import type { Request } from 'express';
import type { AuthContext, AuthenticatedRequest } from '../auth-context';
import { Clock } from '../clock';
import { RequestContext } from '../context/request-context';
import { getAccessRules } from '../decorators/access.decorators';
import { ApiError } from '../errors/api-error';
import { PrismaService } from '../../prisma/prisma.service';

interface AccessTokenPayload {
  sub: string;
  tv: number;
}

/**
 * Verifies the access token and rebuilds the caller from the database on every request, so a
 * deactivated user, a bumped `tokenVersion` or a changed permission set takes effect at once
 * (§6.4.1, §10.1 S8).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const [rule] = getAccessRules(handler);
    if (rule?.kind === 'public') return true;

    const req = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new ApiError('AUTH_REQUIRED');

    const payload = this.verify(header.slice('Bearer '.length));
    const user = await this.prisma.user.findUnique({
      where: { id: Number(payload.sub) },
      include: { permissions: { select: { permissionKey: true } } },
    });
    if (!user || !user.isActive || user.tokenVersion !== payload.tv) throw new ApiError('AUTH_TOKEN_INVALID');

    const isAdmin = user.role === 'ADMIN';
    const permissions: ReadonlySet<PermissionKey> = isAdmin
      ? new Set(PERMISSION_KEYS)
      : new Set(user.permissions.map((p) => p.permissionKey as PermissionKey));

    const auth: AuthContext = {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      isAdmin,
      mustChangePassword: user.mustChangePassword,
      permissions,
      canViewCost: isAdmin || permissions.has('items.viewCost'),
      ip: req.ip ?? '',
      requestId: RequestContext.get()?.requestId ?? '',
    };

    req.auth = auth;
    RequestContext.setUserId(user.id);
    return true;
  }

  private verify(token: string): AccessTokenPayload {
    try {
      // Expiry is judged by the injected clock, the same one that issued the token.
      return this.jwt.verify<AccessTokenPayload>(token, {
        algorithms: ['HS256'],
        clockTimestamp: Math.floor(this.clock.now().getTime() / 1000),
      });
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw new ApiError(expired ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID');
    }
  }
}
