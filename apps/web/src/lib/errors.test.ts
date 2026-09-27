// @vitest-environment jsdom
import { toast } from 'sonner';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { ApiError } from './api-error';
import { handleApiError } from './errors';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('./auth', () => ({ refreshMe: vi.fn(() => Promise.resolve()) }));

describe('handleApiError toasts', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  beforeEach(() => vi.mocked(toast.error).mockClear());

  it('writes the amounts in a message the way the app writes amounts', () => {
    handleApiError(new ApiError('CREDIT_LIMIT_EXCEEDED', 409, { excess: 1_250_000, canOverride: false }));
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe('This exceeds the credit limit by 1,250,000 IQD.');
  });

  it('gives a server failure its reference, so it can be quoted to the administrator', () => {
    handleApiError(new ApiError('INTERNAL_ERROR', 500, undefined, undefined, 'b1c2d3e4'));
    const [message, options] = vi.mocked(toast.error).mock.calls[0] ?? [];
    expect(message).toMatch(/try again/i);
    // Isolated, so a Kurdish or Arabic sentence around it cannot reorder the groups of a UUID (§7.11).
    expect(options).toEqual({ description: 'Reference: \u2068b1c2d3e4\u2069' });
  });

  it('adds no reference to a refusal the user can act on', () => {
    handleApiError(new ApiError('ORDER_CANCELLED', 409, undefined, undefined, 'b1c2d3e4'));
    expect(vi.mocked(toast.error).mock.calls[0]).toEqual(['This order is cancelled']);
  });
});

describe('handleApiError validation errors with no field on the form', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  beforeEach(() => vi.mocked(toast.error).mockClear());

  it('names the field, its line and the limit in one message', () => {
    handleApiError(
      new ApiError('VALIDATION_FAILED', 400, undefined, [
        { path: 'lines.1.quantity', code: 'too_small', params: { minimum: 1 } },
      ]),
      { fields: ['date'] },
    );
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe('Quantity (line 2): Must be at least 1');
  });

  it('says "A field" for a name it does not know, rather than an internal path', () => {
    handleApiError(new ApiError('VALIDATION_FAILED', 400, undefined, [{ path: 'version', code: 'required' }]));
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe('A field: This field is required');
  });
});
