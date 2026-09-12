import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordBody, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type AuthTokenDto } from '@pallet/shared';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field, FieldError, FieldLabel } from '@/components/app/field';
import { PasswordInput } from '@/components/app/password-input';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { authStore } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

/**
 * The request schema plus what only the form needs: the length rule, checked here so the user
 * hears about it before submitting, and `confirmNewPassword`, which the API never sees (§7.3.2).
 */
const ChangePasswordFormSchema = ChangePasswordBody.extend({
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  confirmNewPassword: z.string().min(1),
}).refine((values) => values.newPassword === values.confirmNewPassword, {
  path: ['confirmNewPassword'],
  params: { code: 'passwordMismatch' },
  error: 'validation.passwordMismatch',
});

/**
 * Changes the signed-in user's own password. The response carries a fresh session, so the tab
 * that changed it stays signed in; the page decides where to go afterwards.
 */
export function ChangePasswordForm({ onSuccess }: { onSuccess?: () => void | Promise<void> }) {
  const { t } = useTranslation();

  const form = useForm({
    resolver: zodResolver(ChangePasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmNewPassword: '' },
    mode: 'onTouched',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      // No `skipAuthRetry`: a wrong current password is a 400, so a 401 here only ever means a stale
      // or expired token — exactly what a refresh fixes (another tab changed the password first).
      const session = await apiFetch<AuthTokenDto>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: values.currentPassword, newPassword: values.newPassword },
      });
      authStore.setSession(session);
      form.reset();
      toast.success(t('account.password.changed'));
      await onSuccess?.();
    } catch (error) {
      handleApiError(error, {
        setError: form.setError,
        fields: ['currentPassword', 'newPassword'],
        fieldMap: {
          CURRENT_PASSWORD_INCORRECT: 'currentPassword',
          PASSWORD_TOO_SHORT: 'newPassword',
          PASSWORD_TOO_LONG: 'newPassword',
          PASSWORD_TOO_COMMON: 'newPassword',
          PASSWORD_SAME_AS_CURRENT: 'newPassword',
        },
      });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field>
        <FieldLabel htmlFor="currentPassword">{t('auth.changePassword.current')}</FieldLabel>
        <PasswordInput
          id="currentPassword"
          autoComplete="current-password"
          aria-invalid={Boolean(form.formState.errors.currentPassword)}
          aria-describedby="currentPassword-error"
          {...form.register('currentPassword')}
        />
        <FieldError id="currentPassword-error" message={form.formState.errors.currentPassword?.message} />
      </Field>

      <Field>
        <FieldLabel htmlFor="newPassword">{t('auth.changePassword.new')}</FieldLabel>
        <PasswordInput
          id="newPassword"
          autoComplete="new-password"
          aria-invalid={Boolean(form.formState.errors.newPassword)}
          aria-describedby="newPassword-error newPassword-rules"
          {...form.register('newPassword')}
        />
        <ul id="newPassword-rules" className="text-muted-foreground list-disc ps-5 text-sm">
          <li>{t('auth.changePassword.ruleLength', { count: PASSWORD_MIN_LENGTH })}</li>
          <li>{t('auth.changePassword.ruleCommon')}</li>
        </ul>
        <FieldError id="newPassword-error" message={form.formState.errors.newPassword?.message} />
      </Field>

      <Field>
        <FieldLabel htmlFor="confirmNewPassword">{t('auth.changePassword.confirm')}</FieldLabel>
        <PasswordInput
          id="confirmNewPassword"
          autoComplete="new-password"
          aria-invalid={Boolean(form.formState.errors.confirmNewPassword)}
          aria-describedby="confirmNewPassword-error"
          {...form.register('confirmNewPassword')}
        />
        <FieldError id="confirmNewPassword-error" message={form.formState.errors.confirmNewPassword?.message} />
      </Field>

      <Button type="submit" disabled={form.formState.isSubmitting} className="self-start">
        {t('auth.changePassword.submit')}
      </Button>
    </form>
  );
}
