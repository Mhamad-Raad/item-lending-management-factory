import { describe, expect, it } from 'vitest';
import { businessDateToLocal, localToBusinessDate, parseTypedDate } from './date-input';

describe('typed dates', () => {
  it('reads dd/MM/yyyy, with Eastern digits and other separators', () => {
    expect(parseTypedDate('12/09/2026')).toBe('2026-09-12');
    expect(parseTypedDate('1/9/2026')).toBe('2026-09-01');
    expect(parseTypedDate('١٢/٠٩/٢٠٢٦')).toBe('2026-09-12');
    expect(parseTypedDate(' 12-09-2026 ')).toBe('2026-09-12');
  });

  it('refuses what is not a real day', () => {
    expect(parseTypedDate('30/02/2026')).toBeNull();
    expect(parseTypedDate('2026-09-12')).toBeNull();
    expect(parseTypedDate('12/09')).toBeNull();
    expect(parseTypedDate('')).toBeNull();
  });

  it('goes to the calendar and back without moving a day', () => {
    expect(localToBusinessDate(businessDateToLocal('2026-03-29'))).toBe('2026-03-29');
    expect(localToBusinessDate(businessDateToLocal('2026-12-31'))).toBe('2026-12-31');
  });
});
