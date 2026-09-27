// @vitest-environment jsdom
import type { ErrorDetails } from '@pallet/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { ApiError } from '@/lib/api-error';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({ options, useSearch: () => ({}) }),
  redirect: vi.fn(),
  useNavigate: () => vi.fn(() => Promise.resolve()),
}));
/** What the mocked sign-in answers: the API's refusal. */
let refusal = new ApiError('UNKNOWN_ERROR', 0);
vi.mock('@/lib/auth', () => ({
  authStore: { getSnapshot: () => ({ status: 'anonymous' }) },
  login: () => Promise.reject(refusal),
}));

const { Route } = (await import('@/routes/login')) as unknown as {
  Route: { options: { component: ComponentType } };
};
const LoginPage = Route.options.component;

async function submit(): Promise<void> {
  fireEvent.change(screen.getByLabelText(i18n.t('auth.login.username')), { target: { value: 'karwan' } });
  fireEvent.change(screen.getByLabelText(i18n.t('auth.login.password')), { target: { value: 'secret' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: i18n.t('auth.login.submit') }));
    await Promise.resolve();
  });
}

describe('login page refusals (Q93)', () => {
  afterEach(cleanup);

  it.each([
    ['en', 'Too many wrong passwords. Wait, then try again. Minutes to wait: 4'],
    ['ckb', 'وشەی تێپەڕ چەند جارێک بە هەڵە نووسرا. چاوەڕێ بکە، پاشان دووبارە هەوڵ بدەوە. ماوەی چاوەڕوانی (خولەک): 4'],
    ['ar', 'أُدخلت كلمة المرور خطأً مرات كثيرة. انتظر ثم حاول مجدداً. مدة الانتظار بالدقائق: 4'],
  ] as const)('tells a locked pair to wait, and for how long, in %s', async (language, message) => {
    await i18n.changeLanguage(language);
    const details = { retryAfterSeconds: 200, retryAfterMinutes: 4 } satisfies ErrorDetails<'LOGIN_THROTTLED'>;
    refusal = new ApiError('LOGIN_THROTTLED', 429, details);
    render(<LoginPage />);

    await submit();

    expect((await screen.findByRole('alert')).textContent).toBe(message);
  });

  it('still says only that the username or password is wrong for a plain failure', async () => {
    await i18n.changeLanguage('en');
    refusal = new ApiError('AUTH_INVALID_CREDENTIALS', 401);
    render(<LoginPage />);

    await submit();

    expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('errors.AUTH_INVALID_CREDENTIALS'));
  });
});
