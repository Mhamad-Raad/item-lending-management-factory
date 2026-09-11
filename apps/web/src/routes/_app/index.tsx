import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { usePageTitle } from '@/hooks/use-page-title';
import { useAuth } from '@/lib/auth';

export const Route = createFileRoute('/_app/')({ component: DashboardPage });

/** The real dashboard (cards, quick actions, recent activity) arrives with its endpoint in M5. */
function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  usePageTitle('dashboard.title');

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.welcome', { name: user?.displayName ?? '' })}
      />
      <Card>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t('dashboard.pending')}</p>
        </CardContent>
      </Card>
    </>
  );
}
