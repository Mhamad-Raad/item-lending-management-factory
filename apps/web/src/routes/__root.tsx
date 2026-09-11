import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Centered } from '@/components/app/centered';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Centered
      title={t('common.notFound.title')}
      body={t('common.notFound.body')}
      action={t('common.notFound.backHome')}
    />
  );
}
