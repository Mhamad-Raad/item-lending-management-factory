import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { BusinessDate } from './common.js';
import { mapZodError } from './zod-issues.js';

/** The field errors the API would send back for this input, as the web app receives them. */
function fieldErrors(schema: z.ZodType, input: unknown): { path: string; code: string }[] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return mapZodError(result.error).map(({ path, code }) => ({ path, code }));
}

describe('U9: shared schemas', () => {
  it('accept only real calendar days, and none before 2000, each with its own code', () => {
    expect(fieldErrors(BusinessDate, '2026-02-28')).toEqual([]);
    // These three codes are what the web app translates; a generic `invalid_type` would not say why.
    expect(fieldErrors(BusinessDate, '2026-02-30')).toEqual([{ path: '', code: 'invalid_date' }]);
    expect(fieldErrors(BusinessDate, '26-02-01')).toEqual([{ path: '', code: 'invalid_date' }]);
    expect(fieldErrors(BusinessDate, 'yesterday')).toEqual([{ path: '', code: 'invalid_date' }]);
    expect(fieldErrors(BusinessDate, '1999-12-31')).toEqual([{ path: '', code: 'too_small' }]);
  });
});
