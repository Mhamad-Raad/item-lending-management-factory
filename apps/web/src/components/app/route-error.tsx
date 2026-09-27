import { Link, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Centered } from './centered';
import { Button } from '@/components/ui/button';
import { isChunkLoadError, reloadOnceForNewVersion } from '@/lib/chunk-reload';
import { ForbiddenError } from '@/lib/route-guards';

/**
 * A route that failed to render or load. A permission the user lacks is its own page; code that could
 * not be downloaded (a deploy replaced it) reloads once and otherwise offers a Reload button (Q81);
 * anything else says so in the user's language — never the raw error text — with Reload and a way home.
 */
export function RouteError({ error }: ErrorComponentProps) {
  const { t } = useTranslation();
  const stale = isChunkLoadError(error);

  useEffect(() => {
    if (stale) reloadOnceForNewVersion();
  }, [stale]);

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
    <main
      role="alert"
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <h1 className="text-2xl font-semibold">{t(stale ? 'common.pageError.staleTitle' : 'common.pageError.title')}</h1>
      <p className="text-muted-foreground">{t(stale ? 'common.pageError.staleBody' : 'common.pageError.body')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => window.location.reload()}>{t('common.actions.reload')}</Button>
        <Button variant="outline" asChild>
          <Link to="/">{t('common.notFound.backHome')}</Link>
        </Button>
      </div>
    </main>
  );
}
