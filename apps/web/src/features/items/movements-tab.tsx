import { formatNumber, formatOrderNumber, type PageDto, type StockMovementDto } from '@pallet/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, History } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

/** In and out by colour, and by sign character and icon as well (§7.15). */
function SignedQuantity({ value }: { value: number }) {
  const Icon = value > 0 ? ArrowUpRight : ArrowDownLeft;
  return (
    <span className={value > 0 ? 'text-success' : 'text-destructive'}>
      <span dir="ltr" className="inline-flex items-center gap-1 tabular-nums">
        <Icon className="size-3.5" aria-hidden />
        {value > 0 ? '+' : '−'}
        {formatNumber(Math.abs(value))}
      </span>
    </span>
  );
}

/** The item's stock ledger, newest first (§7.3.16). */
export function MovementsTab({ itemId }: { itemId: number }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const params = { page, pageSize };
  const movements = useQuery({
    queryKey: qk.items.movements(itemId, params),
    queryFn: () => apiFetch<PageDto<StockMovementDto>>(`/items/${itemId}/stock-movements`, { query: params }),
    placeholderData: keepPreviousData,
  });

  if (movements.isPending) return <PageSkeleton rows={3} />;
  if (movements.isError) return <QueryErrorState error={movements.error} onRetry={() => void movements.refetch()} />;

  const columns: DataColumn<StockMovementDto>[] = [
    {
      id: 'time',
      header: 'items.movements.time',
      cell: (movement) => <DateText value={movement.createdAt} withTime />,
    },
    {
      id: 'reason',
      header: 'items.movements.reason',
      cell: (movement) => t(`enums.stockMovementReason.${movement.reason}`),
      mobile: 'subtitle',
    },
    {
      id: 'quantity',
      header: 'items.movements.quantity',
      cell: (movement) => <SignedQuantity value={movement.quantity} />,
      align: 'end',
    },
    {
      id: 'reference',
      header: 'items.movements.reference',
      cell: (movement) =>
        movement.orderNumber !== null ? (
          <span dir="ltr">#{formatOrderNumber(movement.orderNumber)}</span>
        ) : movement.batchId !== null ? (
          t('items.movements.batchReference', { id: movement.batchId })
        ) : (
          '—'
        ),
    },
    { id: 'note', header: 'items.movements.note', cell: (movement) => movement.note ?? '—', hideBelow: 'lg' },
    { id: 'user', header: 'items.movements.user', cell: (movement) => movement.createdBy.displayName, hideBelow: 'md' },
  ];

  return (
    <DataTable
      label={t('items.detail.tabs.movements')}
      columns={columns}
      rows={movements.data.items}
      rowKey={(movement) => movement.id}
      total={movements.data.total}
      page={movements.data.page}
      pageSize={movements.data.pageSize}
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      isFetching={movements.isFetching}
      empty={<EmptyState icon={History} title={t('items.movements.empty')} />}
    />
  );
}
