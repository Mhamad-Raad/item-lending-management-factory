import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PAGE_SIZES } from '@/lib/list-search';

/** The record count, the page size when the list offers a choice, and the way to the next page. */
export function Pagination({
  page,
  pageSize,
  total,
  totalIsLowerBound = false,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  /**
   * The list stopped counting at `total`, one past its limit (the history, Q100): the count reads
   * "10,000+", and the pages reach the limit, not the end.
   */
  totalIsLowerBound?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}) {
  const { t } = useTranslation();
  const counted = totalIsLowerBound ? total - 1 : total;
  const lastPage = Math.max(1, Math.ceil(counted / pageSize));

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm">
          {totalIsLowerBound
            ? t('common.pagination.totalAtLeast', { total: counted })
            : t('common.pagination.total', { total })}
        </span>
        {onPageSizeChange ? (
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger className="h-10 w-20" aria-label={t('common.pagination.pageSize')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {lastPage > 1 ? (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">
            {totalIsLowerBound
              ? t('common.pagination.pageOpen', { page })
              : t('common.pagination.page', { page, lastPage })}
          </span>
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
