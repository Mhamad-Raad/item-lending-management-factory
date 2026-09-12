import { describe, expect, it } from 'vitest';
import { normalizePhone, toWesternDigits } from './format.js';
import { Phone } from './schemas/common.js';

describe('U12: phone normalization', () => {
  it('strips the spaces, dashes and parentheses people type', () => {
    expect(normalizePhone('0750 123-4567')).toBe('07501234567');
    expect(normalizePhone('+964 (750) 1234567')).toBe('+9647501234567');
  });

  it('reads Arabic-Indic and Extended Arabic-Indic digits as Western ones', () => {
    expect(toWesternDigits('٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789 0123456789');
    expect(normalizePhone('٠٧٥٠ ١٢٣-٤٥٦٧')).toBe('07501234567');
  });

  it('accepts only what is a phone number once normalised', () => {
    expect(Phone.parse('0750 123-4567')).toBe('07501234567');
    expect(Phone.safeParse('12ab').success).toBe(false);
    expect(Phone.safeParse('123456').success).toBe(false);
    expect(Phone.safeParse('+9647501234567890').success).toBe(false);
  });
});
