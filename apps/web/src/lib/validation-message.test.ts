import { describe, expect, it } from 'vitest';
import { decodeValidationMessage, encodeValidationMessage, fieldErrorMessage } from './validation-message';

describe('validation messages', () => {
  it('carries the interpolation values a message needs', () => {
    const message = encodeValidationMessage('too_short', { minimum: 10 });

    expect(decodeValidationMessage(message)).toEqual({ key: 'validation.too_short', params: { minimum: 10 } });
  });

  it('stays a plain key when there is nothing to interpolate', () => {
    expect(encodeValidationMessage('required')).toBe('validation.required');
    expect(decodeValidationMessage('validation.required')).toEqual({ key: 'validation.required', params: {} });
  });

  it('encodes a server field error the same way', () => {
    expect(fieldErrorMessage({ path: 'username', code: 'too_long', params: { maximum: 32 } })).toBe(
      encodeValidationMessage('too_long', { maximum: 32 }),
    );
  });

  it('survives a message that is not one of ours', () => {
    expect(decodeValidationMessage('errors.USERNAME_TAKEN')).toEqual({ key: 'errors.USERNAME_TAKEN', params: {} });
  });
});
