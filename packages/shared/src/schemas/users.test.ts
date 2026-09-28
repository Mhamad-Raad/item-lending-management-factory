import { describe, expect, it } from 'vitest';
import { mapZodError } from './zod-issues.js';
import { DisplayName } from './users.js';

const fieldCodes = (value: unknown): string[] => {
  const result = DisplayName.safeParse(value, { reportInput: true });
  return result.success ? [] : mapZodError(result.error).map((field) => field.code);
};

/** Q121: a display name cannot hide characters that make it read as someone else's. */
describe('DisplayName', () => {
  it('refuses bidi controls, zero-width characters and control characters', () => {
    for (const hidden of ['‮', '⁦', '​', '‍', '⁠', '﻿', '\u0007', '\t']) {
      expect(fieldCodes(`Ahmad${hidden}Ali`)).toEqual(['invisible_characters']);
    }
  });

  it('keeps the zero-width non-joiner that Sorani spelling uses', () => {
    expect(fieldCodes('ئاسۆ‌ی کارگە')).toEqual([]);
  });

  it('still trims and bounds the length first', () => {
    expect(DisplayName.parse('  هێمن  ')).toBe('هێمن');
    expect(fieldCodes('   ')).toEqual(['too_short']);
    expect(fieldCodes('x'.repeat(101))).toEqual(['too_long']);
  });
});
