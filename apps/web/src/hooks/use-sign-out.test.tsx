// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const navigate = vi.fn(() => Promise.resolve());
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (message: string) => toastError(message) } }));

const { useSignOut } = await import('./use-sign-out');

describe('useSignOut (Q80)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    toastError.mockClear();
    localStorage.clear();
  });

  it('goes to the login page and says so when the server could not be told', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed to fetch'));
    const { result } = renderHook(() => useSignOut());

    await expect(result.current()).resolves.toBeUndefined();

    expect(toastError).toHaveBeenCalledWith(i18n.t('auth.logoutFailed'));
    expect(navigate).toHaveBeenCalledWith({ to: '/login' });
  });

  it('goes to the login page without a message when the server signed the session out', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const { result } = renderHook(() => useSignOut());

    await result.current();

    expect(toastError).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: '/login' });
  });
});
