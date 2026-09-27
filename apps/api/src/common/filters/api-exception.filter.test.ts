import { HttpException, Logger, type ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { ApiError } from '../errors/api-error';
import { ApiExceptionFilter } from './api-exception.filter';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

function hostFor(): { host: ArgumentsHost; status: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ id: 'req-1' }), getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status };
}

/** §10.6 D9: only server errors are reported, never what a client got wrong. */
describe('ApiExceptionFilter error reporting', () => {
  // The filter logs the unexpected error too; that log is not what these tests are about.
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  afterEach(() => vi.mocked(Sentry.captureException).mockClear());

  it('reports an unexpected error and a 5xx', () => {
    const filter = new ApiExceptionFilter();
    const crash = new Error('boom');
    filter.catch(crash, hostFor().host);
    filter.catch(new HttpException('down', 503), hostFor().host);
    expect(vi.mocked(Sentry.captureException).mock.calls.map(([error]) => error)).toEqual([
      crash,
      expect.any(HttpException),
    ]);
  });

  it('does not report a client error', () => {
    const filter = new ApiExceptionFilter();
    filter.catch(new ApiError('ORDER_NOT_FOUND'), hostFor().host);
    filter.catch(new HttpException('missing', 404), hostFor().host);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

/** Q82: an unreachable or saturated database is a 503 the client may retry, not a 500 bug. */
describe('ApiExceptionFilter database outages', () => {
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  afterEach(() => vi.mocked(Sentry.captureException).mockClear());

  const known = (code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError =>
    new Prisma.PrismaClientKnownRequestError('failed', { code, clientVersion: '7.10.0', meta });

  function answer(exception: unknown): { status: number; body: unknown } {
    const json = vi.fn<(body: unknown) => void>();
    const status = vi.fn<(code: number) => { json: typeof json }>(() => ({ json }));
    const host = {
      switchToHttp: () => ({ getRequest: () => ({ id: 'req-1' }), getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    new ApiExceptionFilter().catch(exception, host);
    return { status: status.mock.calls[0]?.[0] ?? 0, body: json.mock.calls[0]?.[0] };
  }

  it.each([
    ['P1001 unreachable', known('P1001')],
    ['P1002 timed out', known('P1002')],
    ['P1017 connection closed', known('P1017')],
    ['P2024 pool timeout', known('P2024')],
    ['P2028 transaction', known('P2028')],
    [
      'a raw query that could not reach the server',
      known('P2010', { driverAdapterError: { name: 'DriverAdapterError', cause: { kind: 'DatabaseNotReachable' } } }),
    ],
    ['a server shutting down', known('P2010', { driverAdapterError: { cause: { kind: 'postgres', code: '57P01' } } })],
    ['the pg pool timing out', new Error('timeout exceeded when trying to connect')],
    ['a refused socket', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })],
  ])('%s → 503 SERVICE_UNAVAILABLE, reported as a warning', (_, exception) => {
    expect(answer(exception)).toEqual({
      status: 503,
      body: { error: { code: 'SERVICE_UNAVAILABLE' }, requestId: 'req-1' },
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(exception, {
      level: 'warning',
      fingerprint: ['service-unavailable'],
    });
  });

  it.each([
    ['a wrong database password', known('P1000')],
    ['a missing table', known('P2021')],
    ['a plain bug', new TypeError('x is undefined')],
  ])('%s stays 500 INTERNAL_ERROR and is reported as a bug', (_, exception) => {
    expect(answer(exception)).toMatchObject({ status: 500, body: { error: { code: 'INTERNAL_ERROR' } } });
    expect(Sentry.captureException).toHaveBeenCalledWith(exception);
  });
});
