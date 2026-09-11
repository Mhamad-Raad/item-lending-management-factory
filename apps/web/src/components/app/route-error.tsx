import type { ErrorComponentProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Centered } from './centered';
import { ForbiddenError } from '@/lib/route-guards';

/** A permission the route needed and the user lacks renders as its own page, not as a crash. */
export function RouteError({ error }: ErrorComponentProps) {
  const { t } = useTranslation();

  if (error instanceof ForbiddenError) {
    return (
      <Centered
        title={t('common.forbidden.title')}
        body={t('common.forbidden.body')}
        action={t('common.notFound.backHome')}
      />
    );
  }

  return (
    <Centered
      title={t('errors.UNKNOWN_ERROR')}
      body={error instanceof Error ? error.message : ''}
      action={t('common.notFound.backHome')}
    />
  );
}
