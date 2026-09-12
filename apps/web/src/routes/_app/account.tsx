import { FONT_SIZES, THEMES, type FontSize, type Theme } from '@pallet/shared';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChangePasswordForm } from '@/components/app/change-password-form';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { LanguageSwitcher } from '@/components/app/language-switcher';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePageTitle } from '@/hooks/use-page-title';
import { logoutEverywhere, useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { setPreferences, usePreferences } from '@/lib/preferences';

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

  const endEverySession = async (): Promise<void> => {
    setPending(true);
    try {
      await logoutEverywhere();
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
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
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
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('account.preferences.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t('account.preferences.language')}</legend>
            <LanguageSwitcher />
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
          <CardTitle>{t('auth.changePassword.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('account.security.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <p className="text-muted-foreground text-sm">{t('account.security.logoutAllHint')}</p>
          <Button variant="destructive" onClick={() => setConfirmLogoutAll(true)}>
            {t('account.security.logoutAll')}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmLogoutAll}
        onOpenChange={setConfirmLogoutAll}
        title={t('account.security.logoutAll')}
        description={t('account.security.logoutAllConfirm')}
        confirmLabel={t('account.security.logoutAll')}
        pending={pending}
        onConfirm={() => void endEverySession()}
      />
    </>
  );
}
