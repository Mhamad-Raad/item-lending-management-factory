import { describe, expect, it } from 'vitest';
import { ApiError, apiErrorFromResponse, detailsOf } from './api-error';

describe('detailsOf', () => {
  it('returns the typed details of the code asked for', () => {
    const error = new ApiError('PAYMENT_EXCEEDS_OWED', 409, { owed: 4_000, amount: 5_000 });
    expect(detailsOf(error, 'PAYMENT_EXCEEDS_OWED')?.owed).toBe(4_000);
  });

  it('is null for another code, a detail-less error or anything that is not an ApiError', () => {
    const error = new ApiError('PAYMENT_EXCEEDS_OWED', 409, { owed: 4_000, amount: 5_000 });
    expect(detailsOf(error, 'STOCK_INSUFFICIENT')).toBeNull();
    expect(detailsOf(new ApiError('STOCK_INSUFFICIENT', 409), 'STOCK_INSUFFICIENT')).toBeNull();
    expect(detailsOf(new Error('x'), 'STOCK_INSUFFICIENT')).toBeNull();
  });
});

describe('apiErrorFromResponse', () => {
  it('names a bare proxy 502/503/504 SERVICE_UNAVAILABLE and anything else unreadable UNKNOWN_ERROR', async () => {
    expect((await apiErrorFromResponse(new Response('Bad Gateway', { status: 502 }))).code).toBe('SERVICE_UNAVAILABLE');
    expect((await apiErrorFromResponse(new Response('', { status: 504 }))).code).toBe('SERVICE_UNAVAILABLE');
    expect((await apiErrorFromResponse(new Response('<html>', { status: 500 }))).code).toBe('UNKNOWN_ERROR');
  });
});
