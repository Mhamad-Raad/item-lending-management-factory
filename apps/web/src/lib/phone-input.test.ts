import { describe, expect, it } from 'vitest';
import { keepPhoneCharacters } from './phone-input';

describe('keepPhoneCharacters', () => {
  it('drops letters and signs a phone number never has', () => {
    expect(keepPhoneCharacters('0770abc111')).toBe('0770111');
    expect(keepPhoneCharacters('کاروان')).toBe('');
    expect(keepPhoneCharacters('0770.111,22#33*')).toBe('07701112233');
  });

  it('keeps the grouping people type, and Eastern digits for the save to read', () => {
    expect(keepPhoneCharacters('(0770) 111-2233')).toBe('(0770) 111-2233');
    expect(keepPhoneCharacters('٠٧٧٠ ١١١ ٢٢٣٣')).toBe('٠٧٧٠ ١١١ ٢٢٣٣');
    expect(keepPhoneCharacters('۰۷۵۰۱۲۳۴۵۶۷')).toBe('۰۷۵۰۱۲۳۴۵۶۷');
  });

  it('keeps a plus sign only in front of the number', () => {
    expect(keepPhoneCharacters('+964 770 111 2233')).toBe('+964 770 111 2233');
    expect(keepPhoneCharacters('0770+111')).toBe('0770111');
    expect(keepPhoneCharacters('++964')).toBe('+964');
    expect(keepPhoneCharacters(' +964+')).toBe(' +964');
  });
});
