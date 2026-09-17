import { describe, expect, it } from 'vitest';
import { isLive } from './healthcheck';

/** Q61: the container's liveness is the process and its database; a low disk alerts elsewhere. */
describe('isLive', () => {
  it('is live on a healthy answer', () => {
    expect(isLive(200, { status: 'ok', db: 'ok', disk: 'ok', version: 'x' })).toBe(true);
  });

  it('stays live when only the disk is low, so Caddy keeps serving reads', () => {
    expect(isLive(503, { error: { code: 'SERVICE_UNAVAILABLE', details: { reason: 'disk' } } })).toBe(true);
  });

  it('is not live when the database is unreachable, or the answer is anything else', () => {
    expect(isLive(503, { error: { code: 'SERVICE_UNAVAILABLE', details: { reason: 'database' } } })).toBe(false);
    expect(isLive(503, { error: { code: 'SERVICE_UNAVAILABLE' } })).toBe(false);
    expect(isLive(503, null)).toBe(false);
    expect(isLive(500, { error: { details: { reason: 'disk' } } })).toBe(false);
    expect(isLive(404, {})).toBe(false);
  });
});
