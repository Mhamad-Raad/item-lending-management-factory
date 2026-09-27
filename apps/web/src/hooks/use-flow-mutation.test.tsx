// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const steps: string[] = [];
const navigate = vi.fn((options: unknown) => {
  steps.push(`navigate ${JSON.stringify(options)}`);
  return Promise.resolve();
});
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('sonner', () => ({ toast: { success: (message: string) => steps.push(`toast ${message}`) } }));

const { useFlowMutation } = await import('./use-flow-mutation');

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

function useFlow(refresh: 'before-navigate' | 'after-navigate') {
  return useFlowMutation({
    request: (body: { n: number }) => Promise.resolve({ id: body.n }),
    successMessage: (result) => `saved ${result.id}`,
    invalidate: () => {
      steps.push('invalidate');
      return Promise.resolve();
    },
    refresh,
    beforeLeave: () => steps.push('allow leave'),
    destination: (result) => ({ to: '/orders/$orderId', params: { orderId: String(result.id) } }),
    onError: () => undefined,
  });
}

describe('useFlowMutation', () => {
  afterEach(() => {
    steps.length = 0;
    navigate.mockClear();
  });

  it('refreshes before leaving when the destination must show the new figures at once', async () => {
    const { result } = renderHook(() => useFlow('before-navigate'), { wrapper });
    await act(() => result.current.mutateAsync({ n: 7 }));
    expect(steps).toEqual([
      'toast saved 7',
      'invalidate',
      'allow leave',
      'navigate {"to":"/orders/$orderId","params":{"orderId":"7"}}',
    ]);
  });

  it('leaves first and refreshes behind when the form must not flash the new state', async () => {
    const { result } = renderHook(() => useFlow('after-navigate'), { wrapper });
    await act(() => result.current.mutateAsync({ n: 8 }));
    expect(steps).toEqual([
      'toast saved 8',
      'allow leave',
      'navigate {"to":"/orders/$orderId","params":{"orderId":"8"}}',
      'invalidate',
    ]);
  });

  it('resends a failed payload under its key, and a success starts a new submission', async () => {
    const keys: string[] = [];
    let attempts = 0;
    const { result } = renderHook(
      () =>
        useFlowMutation({
          request: (body: { n: number }, idempotencyKey) => {
            keys.push(idempotencyKey());
            attempts += 1;
            return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ id: body.n });
          },
          successMessage: () => 'saved',
          invalidate: () => Promise.resolve(),
          refresh: 'after-navigate',
          destination: () => ({ to: '/orders' }),
          onError: () => undefined,
        }),
      { wrapper },
    );
    await act(() => result.current.mutateAsync({ n: 1 }).catch(() => undefined));
    await act(() => result.current.mutateAsync({ n: 1 }));
    await act(() => result.current.mutateAsync({ n: 1 }));
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});
