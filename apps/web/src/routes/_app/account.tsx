import { FONT_SIZES, LANGUAGES, THEMES, type FontSize, type Language, type Theme } from '@pallet/shared';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { authStore, useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { LANGUAGE_NATIVE_NAMES, setPreferences, usePreferences } from '@/lib/preferences';
import i18n from '@/i18n';

export const Route = createFileRoute('/_app/account')({ component: AccountPage });

const FONT_SAMPLE_CLASS: Record<FontSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
};

function AccountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const prefs = usePreferences();
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const [pending, setPending] = useState(false);
  usePageTitle('account.title');

  const logoutEverywhere = async (): Promise<void> => {
    setPending(true);
    try {
      await apiFetch<void>('/auth/logout-all', { method: 'POST', skipAuthRetry: true });
      authStore.clear();
      await navigate({ to: '/login' });
    } catch (error) {
      handleApiError(error);
    } finally {
      setPending(false);
      setConfirmLogoutAll(false);
    }
  };

  return (
    <>
      <PageHeader title={t('account.title')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('account.profile.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t('account.profile.username')}</dt>
            <dd className="font-medium">{user?.username}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('account.profile.displayName')}</dt>
            <dd className="font-medium">{user?.displayName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('account.profile.role')}</dt>
            <dd className="font-medium">{user ? t(`enums.role.${user.role}`) : ''}</dd>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('account.preferences.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t('account.preferences.language')}</legend>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((language: Language) => (
                <Button
                  key={language}
                  variant={prefs.language === language ? 'default' : 'outline'}
                  aria-pressed={prefs.language === language}
                  lang={language}
                  onClick={() => {
                    setPreferences({ language });
                    void i18n.changeLanguage(language);
                  }}
                >
                  {LANGUAGE_NATIVE_NAMES[language]}
                </Button>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t('account.preferences.theme')}</legend>
            <div className="flex flex-wrap gap-2">
              {THEMES.map((theme: Theme) => (
                <Button
                  key={theme}
                  variant={prefs.theme === theme ? 'default' : 'outline'}
                  aria-pressed={prefs.theme === theme}
                  onClick={() => setPreferences({ theme })}
                >
                  {t(`account.preferences.themes.${theme}`)}
                </Button>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t('account.preferences.fontSize')}</legend>
            <div className="flex flex-wrap gap-2">
              {FONT_SIZES.map((size: FontSize) => (
                <Button
                  key={size}
                  variant={prefs.fontSize === size ? 'default' : 'outline'}
                  aria-pressed={prefs.fontSize === size}
                  onClick={() => setPreferences({ fontSize: size })}
                >
                  <span className={FONT_SAMPLE_CLASS[size]} aria-hidden>
                    Aa
                  </span>
                  {t(`account.preferences.fontSizes.${size}`)}
                </Button>
              ))}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('account.security.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <Button variant="outline" onClick={() => void navigate({ to: '/change-password' })}>
            {t('auth.changePassword.title')}
          </Button>
          <div className="flex flex-col gap-1">
            <Label className="font-normal">{t('account.security.logoutAllHint')}</Label>
            <Button variant="destructive" onClick={() => setConfirmLogoutAll(true)}>
              {t('account.security.logoutAll')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmLogoutAll}
        onOpenChange={setConfirmLogoutAll}
        title={t('account.security.logoutAll')}
        description={t('account.security.logoutAllConfirm')}
        confirmLabel={t('account.security.logoutAll')}
        pending={pending}
        onConfirm={() => void logoutEverywhere()}
      />
    </>
  );
}
