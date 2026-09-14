import { z } from 'zod';
import { beforeAll, describe, expect, it } from 'vitest';
import { listSearch } from './list-search';
import { encodeValidationMessage } from './validation-message';
import { installZodI18n } from './zod-i18n';

/**
 * The hook runs while zod builds each issue, before the issue has its path. If it throws there, zod falls back to
 * async validation, which the router refuses: every page with a bad value in its address failed to open.
 */
describe('installZodI18n', () => {
  beforeAll(() => installZodI18n());

  it('lets a search param with a bad value fall back to its default', () => {
    expect(z.object({ ...listSearch }).safeParse({ page: 'abc', pageSize: 'huge' })).toEqual({
      success: true,
      data: { page: 1, pageSize: 25 },
    });
    expect(z.object({ ...listSearch })['~standard'].validate({ page: 'abc' })).not.toBeInstanceOf(Promise);
  });

  it('writes a form error as an i18n key with its params', () => {
    const result = z.object({ name: z.string().min(3) }).safeParse({ name: 'ab' });
    expect(result.error?.issues[0]?.message).toBe(encodeValidationMessage('too_short', { minimum: 3 }));
  });
});
