import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-error';

/** Shown until the first successful response; a background refetch never replaces content. */
export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton className="h-9 w-48" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

/**
 * A failed first load. The request id is shown in small print: it is what turns "it broke" into a
 * line an admin can find in the logs.
 */
export function QueryErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const code = error instanceof ApiError ? error.code : 'UNKNOWN_ERROR';
  const requestId = error instanceof ApiError ? error.requestId : undefined;

  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
      <p className="font-medium">{t(`errors.${code}`)}</p>
      {requestId ? <p className="text-muted-foreground font-mono text-xs">{requestId}</p> : null}
      <Button variant="outline" onClick={onRetry}>
        {t('common.actions.retry')}
      </Button>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <p className="font-medium">{title}</p>
      {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      {action}
    </div>
  );
}
