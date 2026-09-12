import { BusinessDate, PAYMENT_TYPES, type OrderListItemDto, type PageDto, type PaymentType } from '@pallet/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { ClipboardList, Plus } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateRangePicker } from '@/components/app/date-picker';
import { DateText } from '@/components/app/date-text';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { ListEmpty, SearchBox } from '@/components/app/list-controls';
import { MoneyText } from '@/components/app/money-text';
import { PageHeader } from '@/components/app/page-header';
import { QuantityText } from '@/components/app/quantity-text';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { StatusBadge } from '@/components/app/status-badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { orderLabel } from '@/features/orders/order-text';
import { usePageTitle } from '@/hooks/use-page-title';
import { useSearchInput } from '@/hooks/use-search-input';
import { apiFetch } from '@/lib/api-client';
import { useCan } from '@/lib/auth';
import { listSearch, sortSearch } from '@/lib/list-search';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';

const STATUSES = ['OPEN', 'SETTLED', 'CANCELLED', 'ALL'] as const;
const ALL_TYPES = 'all';
const id = z.coerce.number().int().min(1).optional().catch(undefined);

const SearchSchema = z.object({
  ...listSearch,
  status: z.enum(STATUSES).optional().catch(undefined),
  customerId: id,
  driverId: id,
  itemId: id,
  paymentType: z.enum(PAYMENT_TYPES).optional().catch(undefined),
  dateFrom: BusinessDate.optional().catch(undefined),
  dateTo: BusinessDate.optional().catch(undefined),
  sort: sortSearch(['orderNumber', 'date', 'owed', 'outValue']),
});

export const Route = createFileRoute('/_app/orders/')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('orders.view'),
  component: OrdersPage,
});

const COLUMNS: DataColumn<OrderListItemDto>[] = [
  {
    id: 'orderNumber',
    header: 'orders.fields.orderNumber',
    cell: (order) => orderLabel(order.orderNumber),
    sortKey: 'orderNumber',
  },
  { id: 'date', header: 'orders.fields.date', cell: (order) => <DateText value={order.date} />, sortKey: 'date' },
  { id: 'customer', header: 'orders.fields.customer', cell: (order) => order.customer.name, mobile: 'subtitle' },
  { id: 'driver', header: 'orders.fields.driver', cell: (order) => order.driver.name, hideBelow: 'lg' },
  {
    id: 'paymentType',
    header: 'orders.fields.paymentType',
    cell: (order) => <PaymentTypeText type={order.paymentType} />,
    hideBelow: 'lg',
  },
  {
    id: 'depositTotal',
    header: 'orders.fields.depositTotal',
    cell: (order) => <MoneyText value={order.depositTotal} />,
    align: 'end',
    hideBelow: 'lg',
  },
  {
    id: 'palletsOut',
    header: 'orders.fields.palletsOut',
    cell: (order) => <QuantityText value={order.outQuantityTotal} />,
    align: 'end',
  },
  {
    id: 'owed',
    header: 'orders.fields.owed',
    cell: (order) => <MoneyText value={order.owed} />,
    sortKey: 'owed',
    align: 'end',
  },
  {
    id: 'outValue',
    header: 'orders.fields.outValue',
    cell: (order) => <MoneyText value={order.outValue} />,
    sortKey: 'outValue',
    align: 'end',
    hideBelow: 'lg',
  },
  {
    id: 'held',
    header: 'orders.fields.held',
    cell: (order) => <MoneyText value={order.held} />,
    align: 'end',
    hideBelow: 'lg',
  },
  { id: 'status', header: 'orders.fields.status', cell: (order) => <StatusBadge status={order.status} /> },
];

function PaymentTypeText({ type }: { type: PaymentType }) {
  const { t } = useTranslation();
  return <>{t(`enums.paymentType.${type}`)}</>;
}

function OrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const canCreate = useCan('orders.create');
  usePageTitle('orders.list.title');

  const commitSearch = useCallback(
    (q: string | undefined) => void navigate({ search: (prev) => ({ ...prev, q, page: 1 }), replace: true }),
    [navigate],
  );
  const [term, setTerm] = useSearchInput(search.q, commitSearch);
  const setFilter = (patch: Partial<typeof search>): void =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }), replace: true });

  // A range typed back to front is not sent: the API would refuse it (§6.2).
  const rangeInvalid = Boolean(search.dateFrom && search.dateTo && search.dateFrom > search.dateTo);
  const params = {
    status: search.status ?? 'OPEN',
    q: search.q,
    customerId: search.customerId,
    driverId: search.driverId,
    itemId: search.itemId,
    paymentType: search.paymentType,
    dateFrom: search.dateFrom,
    dateTo: search.dateTo,
    sort: search.sort,
    page: search.page,
    pageSize: search.pageSize,
  };
  const orders = useQuery({
    queryKey: qk.orders.list(params),
    queryFn: () => apiFetch<PageDto<OrderListItemDto>>('/orders', { query: params }),
    placeholderData: keepPreviousData,
    enabled: !rangeInvalid,
  });

  const newOrder = canCreate ? (
    <Button asChild>
      <Link to="/orders/new">
        <Plus aria-hidden />
        {t('orders.list.new')}
      </Link>
    </Button>
  ) : null;
  const filtered = Boolean(
    search.q ||
    search.customerId ||
    search.driverId ||
    search.itemId ||
    search.paymentType ||
    search.dateFrom ||
    search.dateTo,
  );

  return (
    <>
      <PageHeader title={t('orders.list.title')} actions={newOrder} />

      <Tabs
        value={params.status}
        onValueChange={(status) =>
          setFilter({ status: status === 'OPEN' ? undefined : (status as (typeof STATUSES)[number]) })
        }
      >
        <TabsList>
          {STATUSES.map((status) => (
            <TabsTrigger key={status} value={status}>
              {t(status === 'ALL' ? 'orders.list.allStatuses' : `enums.orderStatus.${status}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-3">
        <SearchBox value={term} onChange={setTerm} />
        <div className="w-56">
          <EntityCombobox
            kind="customer"
            includeArchived
            value={search.customerId ?? null}
            onChange={(customerId) => setFilter({ customerId: customerId ?? undefined })}
            placeholder={t('orders.list.anyCustomer')}
          />
        </div>
        <div className="w-56">
          <EntityCombobox
            kind="driver"
            includeArchived
            value={search.driverId ?? null}
            onChange={(driverId) => setFilter({ driverId: driverId ?? undefined })}
            placeholder={t('orders.list.anyDriver')}
          />
        </div>
        <div className="w-56">
          <EntityCombobox
            kind="item"
            includeArchived
            value={search.itemId ?? null}
            onChange={(itemId) => setFilter({ itemId: itemId ?? undefined })}
            placeholder={t('orders.list.anyItem')}
          />
        </div>
        <Select
          value={search.paymentType ?? ALL_TYPES}
          onValueChange={(value) =>
            setFilter({ paymentType: value === ALL_TYPES ? undefined : (value as PaymentType) })
          }
        >
          <SelectTrigger className="w-44" aria-label={t('orders.fields.paymentType')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>{t('orders.list.anyPaymentType')}</SelectItem>
            {PAYMENT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`enums.paymentType.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangePicker
          idPrefix="orders-date"
          from={search.dateFrom}
          to={search.dateTo}
          onChange={({ from, to }) => setFilter({ dateFrom: from, dateTo: to })}
          error={rangeInvalid ? t('errors.DATE_RANGE_INVALID') : undefined}
        />
      </div>

      {rangeInvalid ? null : orders.isPending ? (
        <PageSkeleton />
      ) : orders.isError ? (
        <QueryErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : (
        <DataTable
          label={t('orders.list.title')}
          columns={COLUMNS}
          rows={orders.data.items}
          rowKey={(order) => order.id}
          rowLink={(order, children) => (
            <Link
              to="/orders/$orderId"
              params={{ orderId: String(order.id) }}
              className="underline-offset-4 hover:underline"
            >
              {children}
            </Link>
          )}
          total={orders.data.total}
          page={orders.data.page}
          pageSize={orders.data.pageSize}
          sort={search.sort}
          defaultSort="-orderNumber"
          onSortChange={(sort) => setFilter({ sort })}
          onPageChange={(page) => void navigate({ search: (prev) => ({ ...prev, page }) })}
          onPageSizeChange={(pageSize) => setFilter({ pageSize })}
          isFetching={orders.isFetching}
          empty={
            <ListEmpty
              filtered={filtered}
              onClearFilters={() => void navigate({ search: { status: search.status }, replace: true })}
              icon={ClipboardList}
              title={t('orders.list.empty')}
              action={newOrder}
            />
          }
        />
      )}
    </>
  );
}
