import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ChangePasswordBody, LoginBody, RefreshBody, type AuthTokenDto, type MeDto } from '@pallet/shared';
import type { Request, Response } from 'express';
import type { AuthContext } from '../../common/auth-context';
import { Authenticated, Public } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ThrottleScope } from '../../common/decorators/throttle-scope.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiError } from '../../common/errors/api-error';
import { ENV, type Env } from '../../config/env';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './auth.constants';
import { contextToMeDto } from './auth.mapper';
import { AuthService, type AuthResult, type RequestOrigin } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  @ThrottleScope('login')
  async login(
    @Body(new ZodValidationPipe(LoginBody)) body: LoginBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenDto> {
    return this.respondWithSession(await this.auth.login(body, origin(req)), res);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ThrottleScope('refresh')
  async refresh(
    @Body(new ZodValidationPipe(RefreshBody.optional())) _body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenDto> {
    try {
      const result = await this.auth.refresh(cookie(req), req.ip ?? '');
      return this.respondWithSession(result, res);
    } catch (error) {
      // Only a refused session clears the cookie; an outage must not sign everyone out.
      if (error instanceof ApiError && error.code === 'AUTH_REFRESH_INVALID') this.clearRefreshCookie(res);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(cookie(req));
    this.clearRefreshCookie(res);
  }

  @Post('logout-all')
  @Authenticated()
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: AuthContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logoutAll(user.userId);
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @Authenticated()
  me(@CurrentUser() user: AuthContext): MeDto {
    // AuthGuard has already loaded the user and its permissions for this request.
    return contextToMeDto(user);
  }

  @Post('change-password')
  @Authenticated()
  @HttpCode(200)
  @ThrottleScope('login')
  async changePassword(
    @CurrentUser() user: AuthContext,
    @Body(new ZodValidationPipe(ChangePasswordBody)) body: ChangePasswordBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenDto> {
    return this.respondWithSession(await this.auth.changePassword(user.userId, body, origin(req)), res);
  }

  private respondWithSession(result: AuthResult, res: Response): AuthTokenDto {
    res.cookie(REFRESH_COOKIE_NAME, result.refresh.value, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: result.refresh.maxAgeMs,
    });
    return result.token;
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    });
  }
}

function cookie(req: Request): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' ? value : undefined;
}

function origin(req: Request): RequestOrigin {
  const userAgent = req.headers['user-agent'];
  return { ip: req.ip ?? '', userAgent: typeof userAgent === 'string' ? userAgent : null };
}
