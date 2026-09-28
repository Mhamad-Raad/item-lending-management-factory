import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChangePasswordForm } from '@/components/app/change-password-form';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { PageHeader } from '@/components/app/page-header';
import { ProfileForm } from '@/components/app/profile-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePageTitle } from '@/hooks/use-page-title';
import { logoutEverywhere, useAuth } from '@/lib/auth';

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
    } catch {
      // This device is signed out whatever happened; the others may not be.
      toast.error(t('account.security.logoutAllFailed'));
    } finally {
      setPending(false);
      setConfirmLogoutAll(false);
    }
    await navigate({ to: '/login' });
  };

  return (
    <>
      <PageHeader title={t('account.title')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('account.profile.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Keyed by user only: a refresh must not remount the form over what is being typed (Q105). */}
          {user ? <ProfileForm key={user.id} user={user} /> : null}
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
