import type { z } from 'zod';
import type { ApiFieldError, ValidationCode } from '../error-codes.js';

/**
 * Maps zod 4 issues to the stable `ValidationCode` set (§6.3.2). The web app renders each code as
 * `validation.<code>` with `params` interpolated, so the mapping lives here and not in the API.
 */
export function mapZodIssue(issue: z.core.$ZodIssue): ApiFieldError[] {
  const path = issue.path.join('.');

  switch (issue.code) {
    case 'invalid_type':
      if (issue.input === undefined) return [{ path, code: 'required' }];
      return [{ path, code: 'invalid_type', params: { expected: issue.expected } }];

    case 'too_small':
      return [
        {
          path,
          code: issue.origin === 'string' ? 'too_short' : 'too_small',
          params: { minimum: Number(issue.minimum) },
        },
      ];

    case 'too_big':
      return [
        {
          path,
          code: issue.origin === 'string' ? 'too_long' : 'too_big',
          params: { maximum: Number(issue.maximum) },
        },
      ];

    case 'invalid_format':
      return [{ path, code: 'invalid_format' }];

    case 'invalid_value':
      return [{ path, code: 'invalid_enum', params: { options: issue.values.map(String).join('|') } }];

    case 'unrecognized_keys':
      // One error per unknown key, each pointing at the key itself.
      return issue.keys.map((key) => ({ path: path ? `${path}.${key}` : key, code: 'unknown_key' }) as ApiFieldError);

    case 'not_multiple_of':
      return [{ path, code: 'not_integer' }];

    case 'custom': {
      const params = issue.params as { code?: ValidationCode; params?: Record<string, string | number> } | undefined;
      if (params?.code) return [{ path, code: params.code, params: params.params }];
      return [{ path, code: 'invalid_type' }];
    }

    default:
      return [{ path, code: 'invalid_type' }];
  }
}

/**
 * Every field error of a failed parse, flattened in issue order. The parse must pass `{ reportInput: true }`:
 * zod 4 leaves `input` off finished issues otherwise, and every value of the wrong type would read as `required`.
 * (Issues handed to `z.config({ customError })` carry it already.)
 */
export function mapZodError(error: z.ZodError): ApiFieldError[] {
  return error.issues.flatMap(mapZodIssue);
}
