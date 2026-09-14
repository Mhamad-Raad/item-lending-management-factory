import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChangePasswordForm } from '@/components/app/change-password-form';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePageTitle } from '@/hooks/use-page-title';
import { logoutEverywhere, useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

export const Route = createFileRoute('/_app/account')({ component: AccountPage });

function AccountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
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
              <dd className="font-medium">
                <bdi>{user?.displayName}</bdi>
              </dd>
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
