import { zodResolver } from '@hookform/resolvers/zod';
import { LoginBody } from '@pallet/shared';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Field, FieldError, FieldLabel } from '@/components/app/field';
import { PasswordInput } from '@/components/app/password-input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-error';
import { authStore, login } from '@/lib/auth';
import { LANGUAGE_NATIVE_NAMES, setPreferences, usePreferences } from '@/lib/preferences';
import i18n from '@/i18n';
import { LANGUAGES, type Language } from '@pallet/shared';
import { useState } from 'react';
import { usePageTitle } from '@/hooks/use-page-title';

const SearchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute('/login')({
  validateSearch: SearchSchema,
  beforeLoad: () => {
    // Someone already signed in has no business on the login page.
    if (authStore.getSnapshot().status === 'authenticated') throw redirect({ to: '/' });
  },
  component: LoginPage,
});

/** Only a relative path is followed, so `?redirect=` cannot send anyone to another site. */
function safeRedirect(target: string | undefined): string {
  if (!target || !target.startsWith('/') || target.startsWith('//')) return '/';
  return target;
}

function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const prefs = usePreferences();
  const [formError, setFormError] = useState<string | null>(null);
  usePageTitle('auth.login.title');

  const form = useForm({
    resolver: zodResolver(LoginBody),
    defaultValues: { username: '', password: '' },
    mode: 'onTouched',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await login(values);
      await navigate({ to: user.mustChangePassword ? '/change-password' : safeRedirect(search.redirect) });
    } catch (error) {
      // Never say which of the two fields was wrong: that would confirm a username exists.
      setFormError(error instanceof ApiError ? `errors.${error.code}` : 'errors.UNKNOWN_ERROR');
    }
  });

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-xl">{t('auth.login.title')}</CardTitle>
              <CardDescription>{t('common.appName')}</CardDescription>
            </div>
            <div className="flex gap-1">
              {LANGUAGES.map((language: Language) => (
                <Button
                  key={language}
                  type="button"
                  size="sm"
                  variant={prefs.language === language ? 'secondary' : 'ghost'}
                  lang={language}
                  aria-pressed={prefs.language === language}
                  onClick={() => {
                    setPreferences({ language });
                    void i18n.changeLanguage(language);
                  }}
                >
                  {LANGUAGE_NATIVE_NAMES[language]}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{t(formError)}</AlertDescription>
              </Alert>
            ) : null}

            <Field>
              <FieldLabel htmlFor="username">{t('auth.login.username')}</FieldLabel>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                aria-invalid={Boolean(form.formState.errors.username)}
                aria-describedby="username-error"
                {...form.register('username')}
              />
              <FieldError id="username-error" message={form.formState.errors.username?.message} />
            </Field>

            <Field>
              <FieldLabel htmlFor="password">{t('auth.login.password')}</FieldLabel>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                aria-invalid={Boolean(form.formState.errors.password)}
                aria-describedby="password-error"
                {...form.register('password')}
              />
              <FieldError id="password-error" message={form.formState.errors.password?.message} />
            </Field>

            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('auth.login.submit')}
            </Button>
            <p className="text-muted-foreground text-sm">{t('auth.login.forgotHint')}</p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
