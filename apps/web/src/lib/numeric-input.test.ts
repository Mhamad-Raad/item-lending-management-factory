import { describe, expect, it } from 'vitest';
import { caretAfterDigits, digitsBefore, parseNumericInput } from './numeric-input';

describe('numeric input', () => {
  it('reads Eastern digits, drops everything else and groups thousands', () => {
    expect(parseNumericInput('١٢٣٤٥', false)).toEqual({ value: 12_345, text: '12,345' });
    expect(parseNumericInput('۵۰۰۰', false)).toEqual({ value: 5_000, text: '5,000' });
    expect(parseNumericInput('12a,3 4', false)).toEqual({ value: 1_234, text: '1,234' });
    expect(parseNumericInput('007', false)).toEqual({ value: 7, text: '7' });
  });

  it('holds an empty box as null, not zero', () => {
    expect(parseNumericInput('', false)).toEqual({ value: null, text: '' });
    expect(parseNumericInput('abc', false)).toEqual({ value: null, text: '' });
    expect(parseNumericInput('0', false)).toEqual({ value: 0, text: '0' });
  });

  it('keeps a leading minus only where negatives are allowed', () => {
    expect(parseNumericInput('-45', true)).toEqual({ value: -45, text: '-45' });
    expect(parseNumericInput('-45', false)).toEqual({ value: 45, text: '45' });
    expect(parseNumericInput('-', true)).toEqual({ value: null, text: '-' });
    expect(parseNumericInput('-0', true)).toEqual({ value: 0, text: '-0' });
  });

  it('puts the caret back after the same digit once separators move', () => {
    // Typing the 4th digit of "1234": the caret was after it, and stays after it once "1,234" shows.
    expect(digitsBefore('1234', 4)).toBe(4);
    expect(caretAfterDigits('1,234', 4)).toBe(5);
    // The caret between "1" and "2" of "1,234" survives a regrouping.
    expect(digitsBefore('1,234', 1)).toBe(1);
    expect(caretAfterDigits('12,345', 1)).toBe(1);
    expect(caretAfterDigits('-45', 0)).toBe(1);
  });
});
