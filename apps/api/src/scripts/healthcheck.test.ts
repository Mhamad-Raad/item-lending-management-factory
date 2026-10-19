import { describe, expect, it } from 'vitest';
import { decide, isLive, START_GRACE_SECONDS, type Strikes } from './healthcheck';

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

/** Q152: three failures in a row past the start grace restart a hung API; the fourth and later kill it. */
describe('decide', () => {
  const key = '42:123456';
  const old = START_GRACE_SECONDS + 300;
  const at = (failures: number): Strikes => ({ key, failures });

  it('resets the count on a success', () => {
    expect(decide(at(2), key, old, true)).toEqual({ next: at(0), signal: null });
  });

  it('does not count failures inside the start grace', () => {
    expect(decide(null, key, START_GRACE_SECONDS - 1, false)).toEqual({ next: at(0), signal: null });
    expect(decide(at(2), key, 10, false)).toEqual({ next: at(2), signal: null });
  });

  it('counts failures after the grace and sends SIGTERM at the third', () => {
    expect(decide(null, key, START_GRACE_SECONDS, false)).toEqual({ next: at(1), signal: null });
    expect(decide(at(1), key, old, false)).toEqual({ next: at(2), signal: null });
    expect(decide(at(2), key, old, false)).toEqual({ next: at(3), signal: 'SIGTERM' });
  });

  it('sends SIGKILL at the fourth failure and every one after', () => {
    expect(decide(at(3), key, old, false)).toEqual({ next: at(4), signal: 'SIGKILL' });
    expect(decide(at(7), key, old, false)).toEqual({ next: at(8), signal: 'SIGKILL' });
  });

  it('starts from zero for a new API process', () => {
    expect(decide(at(3), '43:999999', old, false)).toEqual({ next: { key: '43:999999', failures: 1 }, signal: null });
  });

  it('treats the low-disk 503 as a success (Q61)', () => {
    const live = isLive(503, { error: { code: 'SERVICE_UNAVAILABLE', details: { reason: 'disk' } } });
    expect(decide(at(2), key, old, live)).toEqual({ next: at(0), signal: null });
  });
});
