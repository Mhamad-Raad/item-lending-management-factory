import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChangePasswordForm } from '@/components/app/change-password-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePageTitle } from '@/hooks/use-page-title';
import { useSignOut } from '@/hooks/use-sign-out';
import { useAuth } from '@/lib/auth';
import { requirePasswordChangePending } from '@/lib/route-guards';

export const Route = createFileRoute('/change-password')({
  beforeLoad: requirePasswordChangePending,
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signOut = useSignOut();
  usePageTitle('auth.changePassword.title');
  const { user } = useAuth();

  // Set meanwhile in another tab (Q159): this tab's next refresh clears the flag, and the form would only refuse the
  // old password as the current one, each refusal counting toward the lockout.
  if (user && !user.mustChangePassword) return <Navigate to="/" />;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t('auth.changePassword.title')}</CardTitle>
          <CardDescription>{t('auth.changePassword.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ChangePasswordForm onSuccess={() => navigate({ to: '/' })} />
          <Button type="button" variant="ghost" onClick={() => void signOut()}>
            {t('nav.logout')}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
