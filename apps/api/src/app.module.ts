import { randomUUID } from 'node:crypto';
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { PermissionDeclarationCheck } from './common/checks/permission-declaration.check';
import { ClockModule } from './common/clock.module';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { AppThrottlerGuard, THROTTLER_DEFINITIONS } from './common/guards/app-throttler.guard';
import { AuthGuard } from './common/guards/auth.guard';
import { CsrfGuard } from './common/guards/csrf.guard';
import { PasswordChangeGuard } from './common/guards/password-change.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { ENV, type Env } from './config/env';
import { EnvModule } from './config/env.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    EnvModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          // Always server-generated: the id is persisted as the correlation column of the
          // append-only audit log, so a client must not be able to choose or replay it.
          genReqId: (_req, res) => {
            const id = randomUUID();
            res.setHeader('X-Request-Id', id);
            return id;
          },
          // Never log secrets, tokens or bodies.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'req.body',
              'res.body',
            ],
            remove: true,
          },
          autoLogging: { ignore: (req) => req.url === '/api/health' },
        },
      }),
    }),
    DiscoveryModule,
    // In-memory counters: one API instance (§6.8.8).
    ThrottlerModule.forRoot(THROTTLER_DEFINITIONS),
    ClockModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    // Order matters and is fixed by §6.4.1: throttle → CSRF → authenticate → password gate → permissions.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    PermissionDeclarationCheck,
  ],
})
export class AppModule implements NestModule {
  // After the pino-http middleware, so `req.id` is already assigned.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
