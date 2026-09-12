import type { PageDto, PurchaseBatchDto } from '@pallet/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { MoneyText } from '@/components/app/money-text';
import { QuantityText } from '@/components/app/quantity-text';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { useCan } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { invalidateStock, stockShortageMessage } from './api';
import { BatchDialog } from './batch-dialog';

/**
 * The item's deliveries, newest first (§7.3.16). The cost columns appear only when the server sent
 * cost — it leaves it out for a viewer without `items.viewCost` — and no average cost is shown.
 */
export function BatchesTab({ itemId }: { itemId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canEdit = useCan('purchases.edit');
  const canDelete = useCan('purchases.delete');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PurchaseBatchDto | null>(null);
  const [deleting, setDeleting] = useState<PurchaseBatchDto | null>(null);

  const params = { itemId, sort: '-date', page, pageSize: 25 };
  const batches = useQuery({
    queryKey: qk.purchases.list(params),
    queryFn: () => apiFetch<PageDto<PurchaseBatchDto>>('/purchase-batches', { query: params }),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (batch: PurchaseBatchDto) =>
      apiFetch<void>(`/purchase-batches/${batch.id}`, { method: 'DELETE', query: { version: batch.version } }),
    onSuccess: async () => {
      await invalidateStock(queryClient);
      toast.success(t('purchases.deleted'));
      setDeleting(null);
    },
    onError: (error) => {
      setDeleting(null);
      const shortage = stockShortageMessage(error, t);
      if (shortage) toast.error(shortage);
      else handleApiError(error, { onReload: () => void invalidateStock(queryClient) });
    },
  });

  if (batches.isPending) return <PageSkeleton rows={3} />;
  if (batches.isError) return <QueryErrorState error={batches.error} onRetry={() => void batches.refetch()} />;

  const showCost = batches.data.items.some((batch) => batch.unitCost !== undefined);
  const columns: DataColumn<PurchaseBatchDto>[] = [
    { id: 'date', header: 'purchases.fields.date', cell: (batch) => <DateText value={batch.date} /> },
    {
      id: 'quantity',
      header: 'purchases.fields.quantity',
      cell: (batch) => <QuantityText value={batch.quantity} />,
      align: 'end',
    },
    ...(showCost
      ? [
          {
            id: 'unitCost',
            header: 'purchases.fields.unitCost',
            cell: (batch: PurchaseBatchDto) =>
              batch.unitCost === undefined ? '—' : <MoneyText value={batch.unitCost} />,
            align: 'end' as const,
          },
          {
            id: 'totalCost',
            header: 'purchases.fields.totalCost',
            cell: (batch: PurchaseBatchDto) =>
              batch.totalCost === undefined ? '—' : <MoneyText value={batch.totalCost} />,
            align: 'end' as const,
          },
        ]
      : []),
    { id: 'note', header: 'purchases.fields.note', cell: (batch) => batch.note ?? '—', hideBelow: 'md' },
    ...(canEdit || canDelete
      ? [
          {
            id: 'actions',
            header: 'common.actions.title',
            cell: (batch: PurchaseBatchDto) => (
              <div className="flex justify-end gap-1">
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('common.actions.edit')}
                    onClick={() => setEditing(batch)}
                  >
                    <Pencil aria-hidden />
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('common.actions.delete')}
                    onClick={() => setDeleting(batch)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </div>
            ),
            align: 'end' as const,
          },
        ]
      : []),
  ];

  return (
    <>
      <DataTable
        label={t('items.detail.tabs.batches')}
        columns={columns}
        rows={batches.data.items}
        rowKey={(batch) => batch.id}
        total={batches.data.total}
        page={batches.data.page}
        pageSize={batches.data.pageSize}
        onPageChange={setPage}
        isFetching={batches.isFetching}
        empty={<EmptyState icon={PackagePlus} title={t('purchases.empty')} />}
      />
      {editing ? (
        <BatchDialog
          key={editing.id}
          itemId={itemId}
          batch={editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('purchases.deleteTitle')}
        description={t('purchases.deleteBody')}
        confirmLabel={t('common.actions.delete')}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </>
  );
}
