// @vitest-environment jsdom
import type { MeDto } from '@pallet/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { ApiError } from '@/lib/api-error';
import { installZodI18n } from '@/lib/zod-i18n';

const apiFetch = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) as unknown }));
const setUser = vi.fn();
vi.mock('@/lib/auth', () => ({ authStore: { setUser: (me: MeDto) => setUser(me) }, refreshMe: vi.fn() }));
vi.mock('@/hooks/use-unsaved-changes-guard', () => ({
  useUnsavedChangesGuard: () => ({ allowLeave: vi.fn(), dialog: null }),
}));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('sonner', () => ({ toast }));

const { ProfileForm } = await import('./profile-form');
// As `main.tsx` does: zod issues become `validation.*` keys.
installZodI18n();

const ME: MeDto = {
  id: 7,
  username: 'karwan',
  displayName: 'Karwan',
  role: 'EMPLOYEE',
  mustChangePassword: false,
  permissions: ['orders.view'],
  version: 3,
};

function nameInput(): HTMLInputElement {
  return screen.getByLabelText(i18n.t('account.profile.displayName'));
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: i18n.t('common.actions.save') });
}

async function save(): Promise<void> {
  await act(async () => {
    fireEvent.click(saveButton());
    await Promise.resolve();
  });
}

describe('own profile form (Q94)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    apiFetch.mockReset();
    setUser.mockReset();
    toast.success.mockReset();
  });
  afterEach(cleanup);

  it('shows the username and role read-only, and saves only a changed name', async () => {
    render(<ProfileForm user={ME} />);

    expect(screen.getByText('karwan')).toBeTruthy();
    expect(screen.getByText(i18n.t('enums.role.EMPLOYEE'))).toBeTruthy();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(nameInput(), { target: { value: ' Karwan ' } });
    expect(saveButton().disabled).toBe(true);

    const saved: MeDto = { ...ME, displayName: 'Karwan Aziz', version: 4 };
    apiFetch.mockResolvedValue(saved);
    fireEvent.change(nameInput(), { target: { value: '  Karwan Aziz ' } });
    expect(saveButton().disabled).toBe(false);
    await save();

    expect(apiFetch).toHaveBeenCalledWith('/auth/me', {
      method: 'PATCH',
      body: { version: 3, displayName: 'Karwan Aziz' },
    });
    expect(setUser).toHaveBeenCalledWith(saved);
    expect(toast.success).toHaveBeenCalledWith('Your name is saved');
  });

  it('refuses an empty name before sending it', async () => {
    render(<ProfileForm user={ME} />);

    fireEvent.change(nameInput(), { target: { value: '   ' } });
    await save();

    expect(apiFetch).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent).toBe('Must be at least 1 characters');
  });

  it.each([
    ['en', 'Must be at most 100 characters'],
    ['ckb', 'دەبێت زۆرترین 100 پیت بێت'],
    ['ar', 'يجب ألا يزيد عن 100 حرفاً'],
  ] as const)('puts the API field error under the name, in %s', async (language, message) => {
    await i18n.changeLanguage(language);
    apiFetch.mockRejectedValue(
      new ApiError('VALIDATION_FAILED', 400, undefined, [
        { path: 'displayName', code: 'too_long', params: { maximum: 100 } },
      ]),
    );
    render(<ProfileForm user={ME} />);

    fireEvent.change(nameInput(), { target: { value: 'Karwan Aziz' } });
    await save();

    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(setUser).not.toHaveBeenCalled();
  });
});
