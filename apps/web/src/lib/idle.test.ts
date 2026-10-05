// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_LIMIT_MS, idleLimitReached, noteActivity, startActivity, wasLeftIdle } from './idle';
import { readLastActivity, writeLastActivity } from './idle-storage';

const START = Date.parse('2026-10-05T09:00:00Z');

describe('the shared record of the last activity (Q136)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    localStorage.clear();
    startActivity();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('is written at once, then at most every five seconds — but never left behind the last activity', () => {
    expect(readLastActivity()).toBe(START);

    vi.advanceTimersByTime(1_000);
    noteActivity();
    vi.advanceTimersByTime(3_000);
    noteActivity();
    // Inside the throttle: other tabs still read the first write.
    expect(readLastActivity()).toBe(START);

    // When it ends the latest activity is written, with nothing more done in this tab.
    vi.advanceTimersByTime(1_000);
    expect(readLastActivity()).toBe(START + 4_000);

    vi.advanceTimersByTime(15_000);
    noteActivity();
    expect(readLastActivity()).toBe(START + 20_000);
  });

  it('counts the limit from the latest activity of any tab', () => {
    vi.setSystemTime(START + IDLE_LIMIT_MS - 1);
    expect(idleLimitReached()).toBe(false);
    vi.setSystemTime(START + IDLE_LIMIT_MS);
    expect(idleLimitReached()).toBe(true);

    // Another tab was at work two minutes ago.
    writeLastActivity(START + IDLE_LIMIT_MS - 120_000);
    expect(idleLimitReached()).toBe(false);
  });

  it('knows a browser opened again after the limit from one opened in time, and from one with no record', () => {
    vi.setSystemTime(START + IDLE_LIMIT_MS - 1);
    expect(wasLeftIdle()).toBe(false);
    vi.setSystemTime(START + IDLE_LIMIT_MS);
    expect(wasLeftIdle()).toBe(true);

    localStorage.clear();
    expect(wasLeftIdle()).toBe(false);
  });
});
