import type { CustomerDto, PageDto } from '@pallet/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Building2, Plus } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ArchivedBadge } from '@/components/app/archived-badge';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { FilterSwitch, ListEmpty, SearchBox } from '@/components/app/list-controls';
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

const COLUMNS: DataColumn<CustomerDto>[] = [
  { id: 'name', header: 'customers.fields.name', cell: (customer) => customer.name, sortKey: 'name' },
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
  },
  {
    id: 'outValue',
    header: 'customers.fields.outValue',
    cell: (customer) => <MoneyText value={customer.summary.outValue} />,
    sortKey: 'outValue',
    align: 'end',
    hideBelow: 'lg',
  },
  {
    id: 'owed',
    header: 'customers.fields.owed',
    cell: (customer) => <MoneyText value={customer.summary.owed} />,
    sortKey: 'owed',
    align: 'end',
  },
  {
    id: 'held',
    header: 'customers.fields.held',
    cell: (customer) => <MoneyText value={customer.summary.held} />,
    sortKey: 'held',
    align: 'end',
    hideBelow: 'lg',
  },
  {
    id: 'creditLimit',
    header: 'customers.fields.creditLimit',
    cell: (customer) => <CreditLimit value={customer.creditLimit} />,
    align: 'end',
    hideBelow: 'lg',
  },
  {
    id: 'status',
    header: 'customers.fields.status',
    cell: (customer) => (customer.archivedAt ? <ArchivedBadge /> : null),
    mobile: 'subtitle',
  },
];

function CustomersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const canCreate = useCan('customers.create');
  usePageTitle('customers.list.title');

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
    sort: search.sort,
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
      <DataTable
        label={t('customers.list.title')}
        columns={COLUMNS}
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
        sort={search.sort}
        defaultSort="name"
        onSortChange={(sort) => setFilter({ sort })}
        onPageChange={(page) => void navigate({ search: (prev) => ({ ...prev, page }) })}
        onPageSizeChange={(pageSize) => setFilter({ pageSize })}
        isFetching={customers.isFetching}
        toolbar={
          <>
            <SearchBox value={term} onChange={setTerm} />
            <FilterSwitch
              id="hasOpenOrders"
              label={t('customers.list.hasOpenOrders')}
              checked={search.hasOpenOrders ?? false}
              onCheckedChange={(on) => setFilter({ hasOpenOrders: on || undefined })}
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
