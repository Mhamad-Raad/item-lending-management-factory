import { BusinessDate, formatOrderNumber, type ReturnListItemDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { Ban, CircleCheck, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DatePicker } from '@/components/app/date-picker';
import { DateText } from '@/components/app/date-text';
import { Undo2 } from '@/components/app/dir-icon';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { FiltersToggle, LIST_FILTERS_ID, ListEmpty, SearchBox } from '@/components/app/list-controls';
import { MoneyText } from '@/components/app/money-text';
import { QuantityText } from '@/components/app/quantity-text';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { orderLabel } from '@/features/orders/order-text';
import { PrintReturnButtons } from '@/features/receipt/print-money-receipt-button';
import { returnListQuery } from '@/features/returns/api';
import { useListRoute } from '@/hooks/use-list-route';
import { usePageTitle } from '@/hooks/use-page-title';
import { useCan } from '@/lib/auth';
import { authStore } from '@/lib/auth-store';
import { listSearch, sortSearch } from '@/lib/list-search';
import { requirePermission } from '@/lib/route-guards';

const id = z.coerce.number().int().min(1).optional().catch(undefined);

const SearchSchema = z.object({
  ...listSearch,
  customerId: id,
  orderId: id,
  itemId: id,
  dateFrom: BusinessDate.optional().catch(undefined),
  dateTo: BusinessDate.optional().catch(undefined),
  sort: sortSearch(['id', 'date', 'refundDue', 'cashRefund']),
});

export const Route = createFileRoute('/_app/returns/')({
  validateSearch: SearchSchema,
  beforeLoad: () => {
    // The list needs orders.view; one who may only record a return is taken straight to the form (Q157, Q168).
    if (!authStore.can('orders.view') && authStore.can('returns.create')) throw redirect({ to: '/returns/new' });
    requirePermission('orders.view');
  },
  component: ReturnsPage,
});

/** Every return, newest first, with the Record return button on top (Q168), laid out as the orders list. */
function ReturnsPage() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const canCreate = useCan('returns.create');
  const canEdit = useCan('returns.edit');
  usePageTitle('returns.list.title');

  const { term, setTerm, setFilter, clearFilters, pageProps } = useListRoute(Route.fullPath, search);

  // A range typed back to front is not sent: the API would refuse it (§6.2).
  const rangeInvalid = Boolean(search.dateFrom && search.dateTo && search.dateFrom > search.dateTo);
  const params = {
    q: search.q,
    customerId: search.customerId,
    orderId: search.orderId,
    itemId: search.itemId,
    dateFrom: search.dateFrom,
    dateTo: search.dateTo,
    sort: search.sort,
    page: search.page,
    pageSize: search.pageSize,
  };
  const returns = useQuery({ ...returnListQuery(params), enabled: !rangeInvalid });

  const newReturn = canCreate ? (
    <Button asChild>
      <Link to="/returns/new">
        <Plus aria-hidden />
        {t('returns.new.title')}
      </Link>
    </Button>
  ) : null;
  const activeFilters = [search.customerId, search.orderId, search.itemId, search.dateFrom ?? search.dateTo].filter(
    Boolean,
  ).length;
  const filtered = Boolean(search.q) || activeFilters > 0;
  // One card at every width, a phone's too — no sheet (Q168); it starts open when the address already filters.
  const [filtersOpen, setFiltersOpen] = useState(() => activeFilters > 0);

  const columns: DataColumn<ReturnListItemDto>[] = [
    {
      id: 'id',
      header: 'returns.list.number',
      // As its paper numbers it (Q166): six digits, so a number read off the paper is found here.
      cell: (pr) => <span dir="ltr">#{formatOrderNumber(pr.id)}</span>,
      sortKey: 'id',
      mobile: 'title',
    },
    {
      id: 'date',
      header: 'orders.money.date',
      cell: (pr) => <DateText value={pr.date} />,
      sortKey: 'date',
      mobile: 'footer',
    },
    {
      id: 'order',
      header: 'orders.fields.orderNumber',
      cell: (pr) => (
        <Link
          to="/orders/$orderId"
          params={{ orderId: String(pr.orderId) }}
          className="text-primary underline-offset-4 hover:underline"
        >
          <span dir="ltr">{orderLabel(pr.orderNumber)}</span>
        </Link>
      ),
      mobile: 'footer',
    },
    {
      id: 'customer',
      header: 'orders.fields.customer',
      cell: (pr) => <bdi>{pr.customer.name}</bdi>,
      mobile: 'subtitle',
      wrap: true,
    },
    {
      id: 'accepted',
      header: 'orders.detail.returnAccepted',
      cell: (pr) => <QuantityText value={pr.accepted} />,
      align: 'end',
      mobile: 'figure',
    },
    {
      id: 'damaged',
      header: 'orders.detail.returnDamaged',
      cell: (pr) => <QuantityText value={pr.damaged} />,
      align: 'end',
      hideBelow: 'lg',
      mobile: 'figure',
    },
    {
      id: 'refundDue',
      header: 'orders.detail.refundDue',
      cell: (pr) => <MoneyText value={pr.refundDue} />,
      sortKey: 'refundDue',
      align: 'end',
      mobile: 'figure',
    },
    {
      id: 'cashRefund',
      header: 'orders.detail.cashRefund',
      cell: (pr) => <MoneyText value={pr.cashRefund} />,
      sortKey: 'cashRefund',
      align: 'end',
      hideBelow: 'md',
      mobile: 'figure',
    },
    {
      id: 'status',
      header: 'orders.list.status',
      cell: (pr) =>
        pr.reversed ? (
          <Badge variant="secondary">
            <Ban aria-hidden />
            {t('orders.detail.reversed')}
          </Badge>
        ) : (
          <Badge variant="success">
            <CircleCheck aria-hidden />
            {t('common.active')}
          </Badge>
        ),
      mobile: 'badge',
    },
    {
      id: 'actions',
      header: 'common.actions.title',
      align: 'end',
      mobile: 'actions',
      // Nothing on a corrected or deleted return, as on its order's page (Q66). A return over several orders also
      // prints all of it, every order on one paper (Q161), beside this order's own part.
      cell: (pr) => {
        if (pr.reversed) return null;
        return (
          <div className="flex items-center justify-end gap-1">
            <PrintReturnButtons
              returnId={pr.id}
              refundEntryId={pr.refundEntryId}
              customerReturnId={pr.customerReturnId}
            />
            {/* Edited on the customer screen, a visit over several orders whole (Q174). */}
            {canEdit ? (
              <Button
                asChild
                variant="ghost"
                size="icon"
                aria-label={t('common.actions.edit')}
                title={t('common.actions.edit')}
              >
                <Link to="/returns/$returnId/edit" params={{ returnId: String(pr.id) }}>
                  <Pencil aria-hidden />
                </Link>
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <h1 className="sr-only">{t('returns.list.title')}</h1>

      {/* Every return is listed, standing or reversed (Q168): no status filter. */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 md:w-md md:flex-none">
          <SearchBox value={term} onChange={setTerm} className="sm:max-w-none" />
        </div>
        <div className="ms-auto flex items-center gap-2">
          <FiltersToggle
            open={filtersOpen}
            onToggle={() => setFiltersOpen((open) => !open)}
            activeCount={activeFilters}
          />
          {newReturn}
        </div>
      </div>

      {filtersOpen ? (
        <div id={LIST_FILTERS_ID} className="bg-card flex flex-col gap-3 rounded-xl border p-3 shadow-sm">
          {/* Five fields of one width, each labelled above: one to a row on a phone, all five in a row from `lg`. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="flex min-w-0 flex-col gap-1">
              <Label>{t('orders.fields.customer')}</Label>
              <EntityCombobox
                kind="customer"
                aria-label={t('orders.fields.customer')}
                includeArchived
                value={search.customerId ?? null}
                onChange={(customerId) => setFilter({ customerId: customerId ?? undefined })}
                placeholder={t('orders.list.anyCustomer')}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Label>{t('orders.fields.orderNumber')}</Label>
              <EntityCombobox
                kind="order"
                aria-label={t('orders.fields.orderNumber')}
                value={search.orderId ?? null}
                onChange={(orderId) => setFilter({ orderId: orderId ?? undefined })}
                placeholder={t('orders.fields.orderNumber')}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Label>{t('orders.lines.item')}</Label>
              <EntityCombobox
                kind="item"
                aria-label={t('orders.lines.item')}
                includeArchived
                value={search.itemId ?? null}
                onChange={(itemId) => setFilter({ itemId: itemId ?? undefined })}
                placeholder={t('orders.list.anyItem')}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor="returns-date-from">{t('common.dateRange.from')}</Label>
              <DatePicker
                id="returns-date-from"
                value={search.dateFrom}
                max={search.dateTo}
                onChange={(next) => setFilter({ dateFrom: next ?? undefined })}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor="returns-date-to">{t('common.dateRange.to')}</Label>
              <DatePicker
                id="returns-date-to"
                value={search.dateTo}
                min={search.dateFrom}
                invalid={rangeInvalid}
                describedBy={rangeInvalid ? 'returns-date-error' : undefined}
                onChange={(next) => setFilter({ dateTo: next ?? undefined })}
              />
            </div>
          </div>
          {rangeInvalid ? (
            <p id="returns-date-error" role="alert" className="text-destructive text-sm">
              {t('errors.DATE_RANGE_INVALID')}
            </p>
          ) : null}
          {activeFilters > 0 ? (
            <Button
              variant="outline"
              className="self-end"
              onClick={() =>
                setFilter({
                  customerId: undefined,
                  orderId: undefined,
                  itemId: undefined,
                  dateFrom: undefined,
                  dateTo: undefined,
                })
              }
            >
              {t('common.actions.clearFilters')}
            </Button>
          ) : null}
        </div>
      ) : rangeInvalid ? (
        <p role="alert" className="text-destructive text-sm">
          {t('errors.DATE_RANGE_INVALID')}
        </p>
      ) : null}

      {rangeInvalid ? null : returns.isPending ? (
        <PageSkeleton />
      ) : returns.isError ? (
        <QueryErrorState error={returns.error} onRetry={() => void returns.refetch()} />
      ) : (
        <DataTable
          label={t('returns.list.title')}
          columns={columns}
          rows={returns.data.items}
          rowKey={(pr) => pr.id}
          total={returns.data.total}
          page={returns.data.page}
          pageSize={returns.data.pageSize}
          sort={search.sort}
          defaultSort="-id"
          {...pageProps}
          isFetching={returns.isFetching}
          empty={
            <ListEmpty
              filtered={filtered}
              onClearFilters={() => clearFilters({})}
              icon={Undo2}
              title={t('returns.list.empty')}
              action={newReturn}
            />
          }
        />
      )}
    </>
  );
}
