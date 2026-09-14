import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-error';
import { isolate } from '@/lib/bidi';

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

/** A record that is not there is not a failure to retry (§7.3). */
const NOT_FOUND_CODES = new Set<string>([
  'NOT_FOUND',
  'ITEM_NOT_FOUND',
  'CUSTOMER_NOT_FOUND',
  'DRIVER_NOT_FOUND',
  'ORDER_NOT_FOUND',
  'USER_NOT_FOUND',
]);

export function NotFoundState({ backLink }: { backLink: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border p-6">
      <p className="font-medium">{t('common.notFound.record')}</p>
      {backLink}
    </div>
  );
}

/**
 * A failed first load. The request id is shown in small print: it is what turns "it broke" into a
 * line an admin can find in the logs.
 */
export function QueryErrorState({
  error,
  onRetry,
  backLink,
}: {
  error: unknown;
  onRetry: () => void;
  /** Where a record that does not exist sends the user instead: the list it would be in. */
  backLink?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const code = error instanceof ApiError ? error.code : 'UNKNOWN_ERROR';
  if (backLink && NOT_FOUND_CODES.has(code)) return <NotFoundState backLink={backLink} />;
  const requestId = error instanceof ApiError ? error.requestId : undefined;

  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
      <p className="font-medium">{t(`errors.${code}`)}</p>
      {requestId ? (
        <p className="text-muted-foreground text-xs">{t('common.errorReference', { id: isolate(requestId) })}</p>
      ) : null}
      <Button variant="outline" onClick={onRetry}>
        {t('common.actions.retry')}
      </Button>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
      {Icon ? <Icon className="text-muted-foreground size-10" aria-hidden /> : null}
      <p className="font-medium">{title}</p>
      {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      {action}
    </div>
  );
}
