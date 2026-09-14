import { HttpException, Logger, type ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
