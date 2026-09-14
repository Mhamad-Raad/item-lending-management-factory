import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors/api-error';
import { ZodValidationPipe } from './zod-validation.pipe';

function fieldErrorsOf(pipe: ZodValidationPipe<unknown>, value: unknown): unknown {
  try {
    pipe.transform(value);
  } catch (error) {
    if (error instanceof ApiError) return error.fields;
    throw error;
  }
  return [];
}

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.strictObject({ name: z.string(), quantity: z.number().int() }));

  it('tells a missing field from one of the wrong type (§6.3.2)', () => {
    expect(fieldErrorsOf(pipe, { quantity: 1 })).toEqual([{ path: 'name', code: 'required' }]);
    expect(fieldErrorsOf(pipe, { name: 7, quantity: 1.5 })).toEqual([
      { path: 'name', code: 'invalid_type', params: { expected: 'string' } },
      { path: 'quantity', code: 'invalid_type', params: { expected: 'int' } },
    ]);
  });
});
