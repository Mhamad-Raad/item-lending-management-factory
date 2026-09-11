import { describe, expect, it } from 'vitest';
import { businessDayRangeToUtc, businessDayStartUtc, businessToday } from './dates.js';

describe('Baghdad business days', () => {
  it('U13: rolls over at 21:00 UTC', () => {
    expect(businessToday(new Date('2026-09-11T20:59:59Z'))).toBe('2026-09-11');
    expect(businessToday(new Date('2026-09-11T21:00:00Z'))).toBe('2026-09-12');
  });

  it('starts a business day three hours before UTC midnight', () => {
    expect(businessDayStartUtc('2026-09-12').toISOString()).toBe('2026-09-11T21:00:00.000Z');
  });

  it("uses the offset that was actually in force, not today's", () => {
    // Baghdad observed summer time (UTC+4) until 2008, and business dates reach back to 2000.
    expect(businessDayStartUtc('2005-07-01').toISOString()).toBe('2005-06-30T20:00:00.000Z');
    expect(businessDayStartUtc('2009-07-01').toISOString()).toBe('2009-06-30T21:00:00.000Z');
  });

  it('turns a day range into a half-open UTC interval that includes the whole last day', () => {
    expect(businessDayRangeToUtc('2026-09-12', '2026-09-12')).toEqual({
      gte: new Date('2026-09-11T21:00:00.000Z'),
      lt: new Date('2026-09-12T21:00:00.000Z'),
    });
  });

  it('leaves an open end open, and reports no filter at all when neither bound is given', () => {
    expect(businessDayRangeToUtc('2026-09-12')).toEqual({ gte: new Date('2026-09-11T21:00:00.000Z') });
    expect(businessDayRangeToUtc(undefined, undefined)).toBeUndefined();
  });
});
