import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordBody, PASSWORD_MIN_LENGTH, type AuthTokenDto } from '@pallet/shared';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field, FieldError, FieldLabel } from '@/components/app/field';
import { PasswordInput } from '@/components/app/password-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { authStore, logout } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { requireAuthenticated } from '@/lib/route-guards';

/** `confirmNewPassword` exists only here: the API never sees it (§7.3.2). */
const ChangePasswordForm = ChangePasswordBody.extend({ confirmNewPassword: z.string().min(1) }).refine(
  (values) => values.newPassword === values.confirmNewPassword,
  { path: ['confirmNewPassword'], params: { code: 'passwordMismatch' }, error: 'validation.passwordMismatch' },
);

export const Route = createFileRoute('/change-password')({
  // Reachable while `mustChangePassword` is set: it is the way out of that state.
  beforeLoad: () => requireAuthenticated({ allowPasswordChange: true }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle('auth.changePassword.title');

  const form = useForm({
    resolver: zodResolver(ChangePasswordForm),
    defaultValues: { currentPassword: '', newPassword: '', confirmNewPassword: '' },
    mode: 'onTouched',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const session = await apiFetch<AuthTokenDto>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: values.currentPassword, newPassword: values.newPassword },
        skipAuthRetry: true,
      });
      // The response carries a fresh session, so this tab stays signed in.
      authStore.setSession(session);
      toast.success(t('account.password.changed'));
      await navigate({ to: '/' });
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
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t('auth.changePassword.title')}</CardTitle>
          <CardDescription>{t('auth.changePassword.description')}</CardDescription>
        </CardHeader>
        <CardContent>
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
              <ul id="newPassword-rules" className="text-muted-foreground list-disc text-sm ps-5">
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

            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('auth.changePassword.submit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                await logout();
                await navigate({ to: '/login' });
              }}
            >
              {t('nav.logout')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
