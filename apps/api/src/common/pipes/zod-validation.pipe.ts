import { Injectable, type PipeTransform } from '@nestjs/common';
import { mapZodError } from '@pallet/shared';
import { ZodError, type ZodType } from 'zod';
import { ApiError } from '../errors/api-error';

/**
 * Parses one request parameter with a shared schema. Failures become `VALIDATION_FAILED` with one
 * field error per issue (§6.3.2) — the API never returns prose.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    try {
      // The issues must carry the input: without it the mapper cannot tell a missing field from a wrong one.
      return this.schema.parse(value, { reportInput: true });
    } catch (error) {
      if (error instanceof ZodError) throw new ApiError('VALIDATION_FAILED', undefined, mapZodError(error));
      throw error;
    }
  }
}
