import type { ItemDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Package, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ArchivedBadge } from '@/components/app/archived-badge';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { FilterChoice, ListEmpty, ListFilters, SearchBox } from '@/components/app/list-controls';
import { MoneyText } from '@/components/app/money-text';
import { PageHeader } from '@/components/app/page-header';
import { QuantityText } from '@/components/app/quantity-text';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Thumbnail } from '@/components/app/thumbnail';
import { Button } from '@/components/ui/button';
import { itemListQuery } from '@/features/items/api';
import { LowStockBadge } from '@/features/items/item-badges';
import { usePageTitle } from '@/hooks/use-page-title';
import { useListRoute } from '@/hooks/use-list-route';
import { useCan } from '@/lib/auth';
import { flagSearch, listSearch, sortSearch } from '@/lib/list-search';
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
    wrap: true,
  },
  {
    id: 'depositPrice',
    header: 'items.fields.depositPrice',
    cell: (item) => <MoneyText value={item.depositPrice} />,
    sortKey: 'depositPrice',
    align: 'end',
    mobile: 'figure',
  },
  {
    id: 'onHand',
    header: 'items.fields.quantityOnHand',
    cell: (item) => <QuantityText value={item.quantityOnHand} />,
    sortKey: 'quantityOnHand',
    align: 'end',
    mobile: 'figure',
  },
  {
    id: 'out',
    header: 'items.fields.quantityOut',
    cell: (item) => <QuantityText value={item.quantityOut} />,
    align: 'end',
    hideBelow: 'lg',
    mobile: 'figure',
  },
  {
    id: 'damaged',
    header: 'items.fields.damagedTotal',
    cell: (item) => <QuantityText value={item.damagedTotal} />,
    align: 'end',
    hideBelow: 'lg',
    mobile: 'figure',
  },
  {
    id: 'minStock',
    header: 'items.fields.minStock',
    cell: (item) => (item.minStock === null ? '—' : <QuantityText value={item.minStock} />),
    align: 'end',
    hideBelow: 'lg',
    mobile: 'figure',
  },
  {
    id: 'createdAt',
    header: 'common.fields.createdAt',
    cell: (item) => <DateText value={item.createdAt} />,
    sortKey: 'createdAt',
    hideBelow: 'lg',
    mobile: 'footer',
  },
  {
    id: 'status',
    header: 'items.fields.status',
    cell: (item) =>
      item.isLowStock || item.archivedAt ? (
        <span className="flex flex-wrap gap-1">
          {item.isLowStock ? <LowStockBadge /> : null}
          {item.archivedAt ? <ArchivedBadge /> : null}
        </span>
      ) : null,
    mobile: 'badge',
  },
];

function ItemsPage() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const canCreate = useCan('items.create');
  usePageTitle('items.list.title');

  const { term, setTerm, setFilter, clearFilters, pageProps } = useListRoute(Route.fullPath, search);

  const params = {
    q: search.q,
    lowStockOnly: search.lowStockOnly,
    includeArchived: search.includeArchived,
    sort: search.sort,
    page: search.page,
    pageSize: search.pageSize,
  };
  const items = useQuery(itemListQuery(params));

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
      {/* Search beside the funnel; below `md` the choices move into its sheet rather than take a row each (Q64). */}
      <ListFilters
        search={<SearchBox value={term} onChange={setTerm} />}
        activeCount={[search.lowStockOnly, search.includeArchived].filter(Boolean).length}
        onClear={() => setFilter({ lowStockOnly: undefined, includeArchived: undefined })}
      >
        <FilterChoice
          label={t('items.list.lowStockOnly')}
          offLabel={t('common.filters.all')}
          checked={search.lowStockOnly ?? false}
          onCheckedChange={(on) => setFilter({ lowStockOnly: on || undefined })}
        />
        <FilterChoice
          label={t('common.includeArchived')}
          offLabel={t('common.filters.active')}
          checked={search.includeArchived ?? false}
          onCheckedChange={(on) => setFilter({ includeArchived: on || undefined })}
        />
      </ListFilters>

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
        {...pageProps}
        isFetching={items.isFetching}
        empty={
          <ListEmpty
            filtered={Boolean(search.q || search.lowStockOnly || search.includeArchived)}
            onClearFilters={() => clearFilters()}
            icon={Package}
            title={t('items.list.empty')}
            action={newItem}
          />
        }
      />
    </>
  );
}
