import type { ItemDto, PageDto } from '@pallet/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Package, Plus } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ArchivedBadge } from '@/components/app/archived-badge';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { FilterSwitch, ListEmpty, SearchBox } from '@/components/app/list-controls';
import { MoneyText } from '@/components/app/money-text';
import { PageHeader } from '@/components/app/page-header';
import { QuantityText } from '@/components/app/quantity-text';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Thumbnail } from '@/components/app/thumbnail';
import { Button } from '@/components/ui/button';
import { LowStockBadge } from '@/features/items/item-badges';
import { usePageTitle } from '@/hooks/use-page-title';
import { useSearchInput } from '@/hooks/use-search-input';
import { apiFetch } from '@/lib/api-client';
import { useCan } from '@/lib/auth';
import { flagSearch, listSearch, sortSearch } from '@/lib/list-search';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';

const SearchSchema = z.object({
  ...listSearch,
  lowStockOnly: flagSearch,
  includeArchived: flagSearch,
  sort: sortSearch(['name', 'quantityOnHand', 'depositPrice', 'createdAt']),
});

export const Route = createFileRoute('/_app/items/')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('items.view'),
  component: ItemsPage,
});

const COLUMNS: DataColumn<ItemDto>[] = [
  {
    id: 'name',
    header: 'items.fields.name',
    cell: (item) => (
      <span className="flex items-center gap-3">
        <Thumbnail url={item.imageUrl} />
        <bdi>{item.name}</bdi>
      </span>
    ),
    sortKey: 'name',
  },
  {
    id: 'depositPrice',
    header: 'items.fields.depositPrice',
    cell: (item) => <MoneyText value={item.depositPrice} />,
    sortKey: 'depositPrice',
    align: 'end',
  },
  {
    id: 'onHand',
    header: 'items.fields.quantityOnHand',
    cell: (item) => <QuantityText value={item.quantityOnHand} />,
    sortKey: 'quantityOnHand',
    align: 'end',
  },
  {
    id: 'out',
    header: 'items.fields.quantityOut',
    cell: (item) => <QuantityText value={item.quantityOut} />,
    align: 'end',
    hideBelow: 'lg',
  },
  {
    id: 'damaged',
    header: 'items.fields.damagedTotal',
    cell: (item) => <QuantityText value={item.damagedTotal} />,
    align: 'end',
    hideBelow: 'lg',
  },
  {
    id: 'minStock',
    header: 'items.fields.minStock',
    cell: (item) => (item.minStock === null ? '—' : <QuantityText value={item.minStock} />),
    align: 'end',
    hideBelow: 'lg',
  },
  {
    id: 'createdAt',
    header: 'common.fields.createdAt',
    cell: (item) => <DateText value={item.createdAt} />,
    sortKey: 'createdAt',
    hideBelow: 'lg',
  },
  {
    id: 'status',
    header: 'items.fields.status',
    cell: (item) => (
      <span className="flex flex-wrap gap-1">
        {item.isLowStock ? <LowStockBadge /> : null}
        {item.archivedAt ? <ArchivedBadge /> : null}
      </span>
    ),
    mobile: 'subtitle',
  },
];

function ItemsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const canCreate = useCan('items.create');
  usePageTitle('items.list.title');

  const commitSearch = useCallback(
    (q: string | undefined) => void navigate({ search: (prev) => ({ ...prev, q, page: 1 }), replace: true }),
    [navigate],
  );
  const [term, setTerm] = useSearchInput(search.q, commitSearch);
  const setFilter = (patch: Partial<typeof search>): void =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }), replace: true });

  const params = {
    q: search.q,
    lowStockOnly: search.lowStockOnly,
    includeArchived: search.includeArchived,
    sort: search.sort,
    page: search.page,
    pageSize: search.pageSize,
  };
  const items = useQuery({
    queryKey: qk.items.list(params),
    queryFn: () => apiFetch<PageDto<ItemDto>>('/items', { query: params }),
    placeholderData: keepPreviousData,
  });

  if (items.isPending) return <PageSkeleton />;
  if (items.isError) return <QueryErrorState error={items.error} onRetry={() => void items.refetch()} />;

  const newItem = canCreate ? (
    <Button asChild>
      <Link to="/items/new">
        <Plus aria-hidden />
        {t('items.list.new')}
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title={t('items.list.title')} actions={newItem} />
      <DataTable
        label={t('items.list.title')}
        columns={COLUMNS}
        rows={items.data.items}
        rowKey={(item) => item.id}
        rowLink={(item, children) => (
          <Link to="/items/$itemId" params={{ itemId: String(item.id) }} className="underline-offset-4 hover:underline">
            {children}
          </Link>
        )}
        total={items.data.total}
        page={items.data.page}
        pageSize={items.data.pageSize}
        sort={search.sort}
        defaultSort="name"
        onSortChange={(sort) => setFilter({ sort })}
        onPageChange={(page) => void navigate({ search: (prev) => ({ ...prev, page }) })}
        onPageSizeChange={(pageSize) => setFilter({ pageSize })}
        isFetching={items.isFetching}
        toolbar={
          <>
            <SearchBox value={term} onChange={setTerm} />
            <FilterSwitch
              id="lowStockOnly"
              label={t('items.list.lowStockOnly')}
              checked={search.lowStockOnly ?? false}
              onCheckedChange={(on) => setFilter({ lowStockOnly: on || undefined })}
            />
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
            filtered={Boolean(search.q || search.lowStockOnly || search.includeArchived)}
            onClearFilters={() => void navigate({ search: {}, replace: true })}
            icon={Package}
            title={t('items.list.empty')}
            action={newItem}
          />
        }
      />
    </>
  );
}
