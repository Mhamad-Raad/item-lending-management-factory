import type { ApiFieldError } from '@pallet/shared';

/**
 * A validation message travels through react-hook-form as a single string, but `validation.*` keys
 * interpolate values (`Must be at least {{minimum}} characters`). The params ride along encoded
 * after a separator so the field can translate the message properly wherever it came from —
 * a client-side zod issue or a server field error.
 */
const SEPARATOR = ' ';

export function encodeValidationMessage(code: string, params?: Record<string, unknown>): string {
  const key = `validation.${code}`;
  return params && Object.keys(params).length > 0 ? `${key}${SEPARATOR}${JSON.stringify(params)}` : key;
}

export function fieldErrorMessage(field: ApiFieldError): string {
  return encodeValidationMessage(field.code, field.params);
}

export function decodeValidationMessage(message: string): { key: string; params: Record<string, unknown> } {
  const [key = '', encoded] = message.split(SEPARATOR);
  if (!encoded) return { key, params: {} };

  try {
    return { key, params: JSON.parse(encoded) as Record<string, unknown> };
  } catch {
    return { key, params: {} };
  }
}
