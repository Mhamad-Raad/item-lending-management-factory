import type { CustomerDto, PageDto } from '@pallet/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Building2, Plus } from 'lucide-react';
import { useCallback } from 'react';
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
import { Button } from '@/components/ui/button';
import { usePageTitle } from '@/hooks/use-page-title';
import { useSearchInput } from '@/hooks/use-search-input';
import { apiFetch } from '@/lib/api-client';
import { useCan } from '@/lib/auth';
import { flagSearch, listSearch, sortSearch } from '@/lib/list-search';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';

const SearchSchema = z.object({
  ...listSearch,
  hasOpenOrders: flagSearch,
  includeArchived: flagSearch,
  sort: sortSearch(['name', 'palletsOut', 'outValue', 'owed', 'held', 'createdAt']),
});

export const Route = createFileRoute('/_app/customers/')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('customers.view'),
  component: CustomersPage,
});

function CreditLimit({ value }: { value: number | null }) {
  const { t } = useTranslation();
  return value === null ? (
    <span className="text-muted-foreground">{t('customers.noLimit')}</span>
  ) : (
    <MoneyText value={value} />
  );
}

/** A sum the API leaves out for a caller without `orders.view` (Q72). */
function OrderMoney({ value }: { value: number | undefined }) {
  return value === undefined ? null : <MoneyText value={value} />;
}

/** The columns and sort keys that are order money: shown only with `orders.view` (Q72). */
const MONEY_COLUMNS: ReadonlySet<string> = new Set(['outValue', 'owed', 'held']);

const COLUMNS: DataColumn<CustomerDto>[] = [
  { id: 'name', header: 'customers.fields.name', cell: (customer) => customer.name, sortKey: 'name', wrap: true },
  {
    id: 'phone',
    header: 'customers.fields.phone',
    cell: (customer) => <span dir="ltr">{customer.phone}</span>,
    mobile: 'subtitle',
  },
  {
    id: 'palletsOut',
    header: 'customers.fields.palletsOut',
    cell: (customer) => <QuantityText value={customer.summary.palletsOut} />,
    align: 'end',
    mobile: 'figure',
  },
  {
    id: 'outValue',
    header: 'customers.fields.outValue',
    cell: (customer) => <OrderMoney value={customer.summary.outValue} />,
    sortKey: 'outValue',
    align: 'end',
    hideBelow: 'lg',
    mobile: 'figure',
  },
  {
    id: 'owed',
    header: 'customers.fields.owed',
    cell: (customer) => <OrderMoney value={customer.summary.owed} />,
    sortKey: 'owed',
    align: 'end',
    mobile: 'figure',
  },
  {
    id: 'held',
    header: 'customers.fields.held',
    cell: (customer) => <OrderMoney value={customer.summary.held} />,
    sortKey: 'held',
    align: 'end',
    hideBelow: 'lg',
    mobile: 'figure',
  },
  {
    id: 'creditLimit',
    header: 'customers.fields.creditLimit',
    cell: (customer) => <CreditLimit value={customer.creditLimit} />,
    align: 'end',
    hideBelow: 'lg',
    mobile: 'figure',
  },
  {
    id: 'createdAt',
    header: 'common.fields.createdAt',
    cell: (customer) => <DateText value={customer.createdAt} />,
    sortKey: 'createdAt',
    hideBelow: 'lg',
    mobile: 'footer',
  },
  {
    id: 'status',
    header: 'customers.fields.status',
    cell: (customer) => (customer.archivedAt ? <ArchivedBadge /> : null),
    mobile: 'badge',
  },
];

function CustomersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const canCreate = useCan('customers.create');
  const canViewOrders = useCan('orders.view');
  usePageTitle('customers.list.title');
  // Without orders.view the API refuses to rank by money; an old link sorted so falls back to the default.
  const sort = !canViewOrders && MONEY_COLUMNS.has(search.sort?.replace(/^-/, '') ?? '') ? undefined : search.sort;
  const columns = canViewOrders ? COLUMNS : COLUMNS.filter((column) => !MONEY_COLUMNS.has(column.id));

  const commitSearch = useCallback(
    (q: string | undefined) => void navigate({ search: (prev) => ({ ...prev, q, page: 1 }), replace: true }),
    [navigate],
  );
  const [term, setTerm] = useSearchInput(search.q, commitSearch);
  const setFilter = (patch: Partial<typeof search>): void =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }), replace: true });

  const params = {
    q: search.q,
    hasOpenOrders: search.hasOpenOrders,
    includeArchived: search.includeArchived,
    sort,
    page: search.page,
    pageSize: search.pageSize,
  };
  const customers = useQuery({
    queryKey: qk.customers.list(params),
    queryFn: () => apiFetch<PageDto<CustomerDto>>('/customers', { query: params }),
    placeholderData: keepPreviousData,
  });

  if (customers.isPending) return <PageSkeleton />;
  if (customers.isError) return <QueryErrorState error={customers.error} onRetry={() => void customers.refetch()} />;

  const newCustomer = canCreate ? (
    <Button asChild>
      <Link to="/customers/new">
        <Plus aria-hidden />
        {t('customers.list.new')}
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title={t('customers.list.title')} actions={newCustomer} />

      {/* Search beside the funnel; below `md` the two choices move into its sheet rather than take a row each (Q64). */}
      <ListFilters
        search={<SearchBox value={term} onChange={setTerm} />}
        activeCount={[search.hasOpenOrders, search.includeArchived].filter(Boolean).length}
        onClear={() => setFilter({ hasOpenOrders: undefined, includeArchived: undefined })}
      >
        <FilterChoice
          label={t('customers.list.hasOpenOrders')}
          offLabel={t('common.filters.all')}
          checked={search.hasOpenOrders ?? false}
          onCheckedChange={(on) => setFilter({ hasOpenOrders: on || undefined })}
        />
        <FilterChoice
          label={t('common.includeArchived')}
          offLabel={t('common.filters.active')}
          checked={search.includeArchived ?? false}
          onCheckedChange={(on) => setFilter({ includeArchived: on || undefined })}
        />
      </ListFilters>
      <DataTable
        label={t('customers.list.title')}
        columns={columns}
        rows={customers.data.items}
        rowKey={(customer) => customer.id}
        rowLink={(customer, children) => (
          <Link
            to="/customers/$customerId"
            params={{ customerId: String(customer.id) }}
            className="underline-offset-4 hover:underline"
          >
            {children}
          </Link>
        )}
        total={customers.data.total}
        page={customers.data.page}
        pageSize={customers.data.pageSize}
        sort={sort}
        defaultSort="name"
        onSortChange={(sort) => setFilter({ sort })}
        onPageChange={(page) => void navigate({ search: (prev) => ({ ...prev, page }) })}
        onPageSizeChange={(pageSize) => setFilter({ pageSize })}
        isFetching={customers.isFetching}
        empty={
          <ListEmpty
            filtered={Boolean(search.q || search.hasOpenOrders || search.includeArchived)}
            onClearFilters={() => void navigate({ search: {}, replace: true })}
            icon={Building2}
            title={t('customers.list.empty')}
            action={newCustomer}
          />
        }
      />
    </>
  );
}
