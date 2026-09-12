import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/** The record count and, when there is more than one page, the way to the next one. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-muted-foreground text-sm">{t('common.pagination.total', { total })}</span>
      {lastPage > 1 ? (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">{t('common.pagination.page', { page, lastPage })}</span>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            {t('common.pagination.previous')}
          </Button>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => onPageChange(page + 1)}>
            {t('common.pagination.next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
