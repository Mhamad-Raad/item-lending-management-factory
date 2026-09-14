import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_CODE_LIST } from './error-codes.js';

/** U8 (§14.2). */
describe('U8: error codes', () => {
  it('answer with a client or server error status between 400 and 503', () => {
    const outside = ERROR_CODE_LIST.filter((code) => ERROR_CODES[code] < 400 || ERROR_CODES[code] > 503);
    expect(outside).toEqual([]);
  });

  it('are unique UPPER_SNAKE_CASE names', () => {
    expect(new Set(ERROR_CODE_LIST).size).toBe(ERROR_CODE_LIST.length);
    for (const code of ERROR_CODE_LIST) expect(code).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
  });
});
