import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { mapZodError } from './zod-issues.js';

const errorsOf = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input, { reportInput: true });
  return result.success ? [] : mapZodError(result.error);
};

/** §10.4 I1: each zod issue arrives as the ValidationCode the web app has a message for. */
describe('mapZodError', () => {
  const body = z.strictObject({
    name: z.string().min(2).max(5),
    quantity: z.number().int().min(1).max(10),
    kind: z.enum(['CASH', 'LENT']),
    email: z.email().optional(),
    nested: z.strictObject({ note: z.string() }).optional(),
  });
  const valid = { name: 'abc', quantity: 3, kind: 'CASH' };

  it('calls a missing field required, and a value of the wrong type invalid_type', () => {
    expect(errorsOf(body, { quantity: 3, kind: 'CASH' })).toEqual([{ path: 'name', code: 'required' }]);
    expect(errorsOf(body, { ...valid, name: 7 })).toEqual([
      { path: 'name', code: 'invalid_type', params: { expected: 'string' } },
    ]);
  });

  it('tells strings (too_short, too_long) from numbers (too_small, too_big), with the bound', () => {
    expect(errorsOf(body, { ...valid, name: 'a' })).toEqual([
      { path: 'name', code: 'too_short', params: { minimum: 2 } },
    ]);
    expect(errorsOf(body, { ...valid, name: 'abcdef' })).toEqual([
      { path: 'name', code: 'too_long', params: { maximum: 5 } },
    ]);
    expect(errorsOf(body, { ...valid, quantity: 0 })).toEqual([
      { path: 'quantity', code: 'too_small', params: { minimum: 1 } },
    ]);
    expect(errorsOf(body, { ...valid, quantity: 11 })).toEqual([
      { path: 'quantity', code: 'too_big', params: { maximum: 10 } },
    ]);
  });

  it('refuses a fraction where a whole number is expected', () => {
    expect(errorsOf(body, { ...valid, quantity: 1.5 }).map(({ path, code }) => ({ path, code }))).toEqual([
      { path: 'quantity', code: 'invalid_type' },
    ]);
  });

  it('maps a bad format, an enum miss and each unknown key, nested keys by their full path', () => {
    expect(errorsOf(body, { ...valid, email: 'nope' })).toEqual([{ path: 'email', code: 'invalid_format' }]);
    expect(errorsOf(body, { ...valid, kind: 'CARD' })).toEqual([
      { path: 'kind', code: 'invalid_enum', params: { options: 'CASH|LENT' } },
    ]);
    expect(errorsOf(body, { ...valid, a: 1, b: 2 })).toEqual([
      { path: 'a', code: 'unknown_key' },
      { path: 'b', code: 'unknown_key' },
    ]);
    expect(errorsOf(body, { ...valid, nested: { note: 'x', extra: true } })).toEqual([
      { path: 'nested.extra', code: 'unknown_key' },
    ]);
  });

  it("uses a custom issue's own code and params, and falls back to invalid_type without one", () => {
    const coded = z.string().refine(() => false, { params: { code: 'duplicate', params: { other: 'phone' } } });
    expect(errorsOf(coded, 'x')).toEqual([{ path: '', code: 'duplicate', params: { other: 'phone' } }]);
    expect(
      errorsOf(
        z.string().refine(() => false, 'prose never reaches the web'),
        'x',
      ),
    ).toEqual([{ path: '', code: 'invalid_type' }]);
  });
});
