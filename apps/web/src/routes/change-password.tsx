import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChangePasswordForm } from '@/components/app/change-password-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePageTitle } from '@/hooks/use-page-title';
import { logout } from '@/lib/auth';
import { requireAuthenticated } from '@/lib/route-guards';

export const Route = createFileRoute('/change-password')({
  // Reachable while `mustChangePassword` is set: it is the way out of that state.
  beforeLoad: () => requireAuthenticated({ allowPasswordChange: true }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle('auth.changePassword.title');

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t('auth.changePassword.title')}</CardTitle>
          <CardDescription>{t('auth.changePassword.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ChangePasswordForm onSuccess={() => navigate({ to: '/' })} />
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
        </CardContent>
      </Card>
    </main>
  );
}
