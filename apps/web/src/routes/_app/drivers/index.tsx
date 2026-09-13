import type { DriverDto, PageDto } from '@pallet/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Archive, Pencil, Plus, Truck } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { ArchivedBadge } from '@/components/app/archived-badge';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { FilterSwitch, ListEmpty, SearchBox } from '@/components/app/list-controls';
import { PageHeader } from '@/components/app/page-header';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { DriverDialog } from '@/features/drivers/driver-dialog';
import { useDialogState } from '@/hooks/use-dialog-state';
import { usePageTitle } from '@/hooks/use-page-title';
import { useSearchInput } from '@/hooks/use-search-input';
import { isolate } from '@/lib/bidi';
import { apiFetch } from '@/lib/api-client';
import { useCan } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { flagSearch, listSearch, sortSearch } from '@/lib/list-search';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';

const SearchSchema = z.object({ ...listSearch, includeArchived: flagSearch, sort: sortSearch(['name', 'createdAt']) });

export const Route = createFileRoute('/_app/drivers/')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('drivers.view'),
  component: DriversPage,
});

/** The dialog open on the page: a new driver, an edit, or an archive to confirm. */
type Open = { kind: 'new' } | { kind: 'edit'; driver: DriverDto } | { kind: 'archive'; driver: DriverDto } | null;

function DriversPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const can = { create: useCan('drivers.create'), edit: useCan('drivers.edit'), archive: useCan('drivers.delete') };
  const [open, setOpen] = useState<Open>(null);
  const editor = useDialogState(open?.kind === 'new' || open?.kind === 'edit' ? open : null);
  usePageTitle('drivers.list.title');

  const commitSearch = useCallback(
    (q: string | undefined) => void navigate({ search: (prev) => ({ ...prev, q, page: 1 }), replace: true }),
    [navigate],
  );
  const [term, setTerm] = useSearchInput(search.q, commitSearch);
  const setFilter = (patch: Partial<typeof search>): void =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }), replace: true });

  const params = {
    q: search.q,
    includeArchived: search.includeArchived,
    sort: search.sort,
    page: search.page,
    pageSize: search.pageSize,
  };
  const drivers = useQuery({
    queryKey: qk.drivers.list(params),
    queryFn: () => apiFetch<PageDto<DriverDto>>('/drivers', { query: params }),
    placeholderData: keepPreviousData,
  });

  const archive = useMutation({
    mutationFn: (driver: DriverDto) =>
      apiFetch(`/drivers/${driver.id}`, { method: 'DELETE', query: { version: driver.version } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.drivers.all() });
      toast.success(t('drivers.list.archived'));
      setOpen(null);
    },
    onError: (error) => {
      setOpen(null);
      handleApiError(error, { onReload: () => void queryClient.invalidateQueries({ queryKey: qk.drivers.all() }) });
    },
  });

  if (drivers.isPending) return <PageSkeleton />;
  if (drivers.isError) return <QueryErrorState error={drivers.error} onRetry={() => void drivers.refetch()} />;

  const columns: DataColumn<DriverDto>[] = [
    { id: 'name', header: 'drivers.fields.name', cell: (driver) => driver.name, sortKey: 'name' },
    {
      id: 'phone',
      header: 'drivers.fields.phone',
      cell: (driver) => <span dir="ltr">{driver.phone}</span>,
      mobile: 'subtitle',
    },
    {
      id: 'carNumber',
      header: 'drivers.fields.carNumber',
      cell: (driver) => <span dir="ltr">{driver.carNumber}</span>,
    },
    {
      id: 'createdAt',
      header: 'common.fields.createdAt',
      cell: (driver) => <DateText value={driver.createdAt} />,
      sortKey: 'createdAt',
      hideBelow: 'lg',
    },
    {
      id: 'status',
      header: 'drivers.fields.status',
      cell: (driver) => (driver.archivedAt ? <ArchivedBadge /> : null),
      mobile: 'subtitle',
    },
    ...(can.edit || can.archive
      ? [
          {
            id: 'actions',
            header: 'common.actions.title' as const,
            align: 'end' as const,
            cell: (driver: DriverDto) =>
              driver.archivedAt ? null : (
                <div className="flex justify-end gap-1">
                  {can.edit ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('common.actions.edit')}
                      onClick={() => setOpen({ kind: 'edit', driver })}
                    >
                      <Pencil aria-hidden />
                    </Button>
                  ) : null}
                  {can.archive ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('common.actions.archive')}
                      onClick={() => setOpen({ kind: 'archive', driver })}
                    >
                      <Archive aria-hidden />
                    </Button>
                  ) : null}
                </div>
              ),
          },
        ]
      : []),
  ];

  const newDriver = can.create ? (
    <Button onClick={() => setOpen({ kind: 'new' })}>
      <Plus aria-hidden />
      {t('drivers.list.new')}
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title={t('drivers.list.title')} actions={newDriver} />
      <DataTable
        label={t('drivers.list.title')}
        columns={columns}
        rows={drivers.data.items}
        rowKey={(driver) => driver.id}
        total={drivers.data.total}
        page={drivers.data.page}
        pageSize={drivers.data.pageSize}
        sort={search.sort}
        defaultSort="name"
        onSortChange={(sort) => setFilter({ sort })}
        onPageChange={(page) => void navigate({ search: (prev) => ({ ...prev, page }) })}
        onPageSizeChange={(pageSize) => setFilter({ pageSize })}
        isFetching={drivers.isFetching}
        toolbar={
          <>
            <SearchBox value={term} onChange={setTerm} />
            <FilterSwitch
              id="includeArchived"
              label={t('common.includeArchived')}
              checked={search.includeArchived ?? false}
              onCheckedChange={(on) => setFilter({ includeArchived: on || undefined })}
            />
          </>
        }
        empty={
          <ListEmpty
            filtered={Boolean(search.q || search.includeArchived)}
            onClearFilters={() => void navigate({ search: {}, replace: true })}
            icon={Truck}
            title={t('drivers.list.empty')}
            action={newDriver}
          />
        }
      />

      {editor.value ? (
        <DriverDialog
          key={editor.key}
          driver={editor.value.kind === 'edit' ? editor.value.driver : undefined}
          open={editor.open}
          onOpenChange={(next) => !next && setOpen(null)}
        />
      ) : null}
      <ConfirmDialog
        open={open?.kind === 'archive'}
        onOpenChange={(next) => !next && setOpen(null)}
        title={t('drivers.list.archiveTitle', { name: isolate(open?.kind === 'archive' ? open.driver.name : '') })}
        description={t('drivers.list.archiveBody')}
        confirmLabel={t('common.actions.archive')}
        pending={archive.isPending}
        onConfirm={() => open?.kind === 'archive' && archive.mutate(open.driver)}
      />
    </>
  );
}
