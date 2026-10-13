import { describe, expect, it } from 'vitest';
import { businessDateToLocal, localToBusinessDate, parseTypedDate, sanitizeTypedDate } from './date-input';

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

describe('sanitizeTypedDate (Q148)', () => {
  it('keeps digits and slashes and drops everything else', () => {
    expect(sanitizeTypedDate('12/09/2026')).toBe('12/09/2026');
    expect(sanitizeTypedDate('ab12/0x9/20c26')).toBe('12/09/2026');
    expect(sanitizeTypedDate('hello')).toBe('');
    expect(sanitizeTypedDate('12 09 2026!')).toBe('12092026');
  });

  it('reads Eastern digits as Western and - or . as /', () => {
    expect(sanitizeTypedDate('١٢/٠٩/٢٠٢٦')).toBe('12/09/2026');
    expect(sanitizeTypedDate('۱۲-۰۹-۲۰۲۶')).toBe('12/09/2026');
    expect(sanitizeTypedDate('12.09.2026')).toBe('12/09/2026');
  });

  it('keeps everything a typed date may parse from', () => {
    for (const typed of ['12/09/2026', '1/9/2026', '١٢/٠٩/٢٠٢٦', '12-09-2026', '12.09.2026']) {
      expect(parseTypedDate(sanitizeTypedDate(typed))).toBe(parseTypedDate(typed));
    }
  });
});
