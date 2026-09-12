import type { LedgerEntryDto, LedgerEntryType, OrderListItemDto, PageDto } from '@pallet/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ClipboardList, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { MoneyText } from '@/components/app/money-text';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ORDER_COLUMNS } from '@/features/orders/order-columns';
import { orderLabel } from '@/features/orders/order-text';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

const STATUSES = ['OPEN', 'SETTLED', 'CANCELLED', 'ALL'] as const;

/** The customer's orders, with a status choice of their own (§7.3.12). */
export function CustomerOrdersTab({ customerId }: { customerId: number }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('OPEN');
  const [page, setPage] = useState(1);
  const params = { customerId, status, page, pageSize: 25 };
  const orders = useQuery({
    queryKey: qk.orders.list(params),
    queryFn: () => apiFetch<PageDto<OrderListItemDto>>('/orders', { query: params }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-3">
      <Select
        value={status}
        onValueChange={(next) => {
          setStatus(next as (typeof STATUSES)[number]);
          setPage(1);
        }}
      >
        <SelectTrigger className="w-44" aria-label={t('orders.fields.status')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((value) => (
            <SelectItem key={value} value={value}>
              {t(value === 'ALL' ? 'orders.list.allStatuses' : `enums.orderStatus.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {orders.isPending ? (
        <PageSkeleton rows={3} />
      ) : orders.isError ? (
        <QueryErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : (
        <DataTable
          label={t('customers.tabs.orders')}
          columns={ORDER_COLUMNS.filter((column) => column.id !== 'customer')}
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
          onPageChange={setPage}
          isFetching={orders.isFetching}
          empty={<EmptyState icon={ClipboardList} title={t('orders.list.empty')} />}
        />
      )}
    </div>
  );
}

/** A customer's payments or refunds, reversals included, across their orders (§7.3.12). */
export function CustomerLedgerTab({ customerId, types }: { customerId: number; types: readonly LedgerEntryType[] }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  // The API reads a comma list of types (§6.21).
  const params = { customerId, type: types.join(','), page, pageSize: 25 };
  const entries = useQuery({
    queryKey: [...qk.ledger.all(), 'list', params],
    queryFn: () => apiFetch<PageDto<LedgerEntryDto>>('/ledger-entries', { query: params }),
    placeholderData: keepPreviousData,
  });

  const columns: DataColumn<LedgerEntryDto>[] = [
    { id: 'date', header: 'orders.money.date', cell: (entry) => <DateText value={entry.effectiveDate} /> },
    {
      id: 'order',
      header: 'orders.fields.orderNumber',
      cell: (entry) => (
        <Link
          to="/orders/$orderId"
          params={{ orderId: String(entry.orderId) }}
          className="text-primary underline-offset-4 hover:underline"
        >
          {orderLabel(entry.orderNumber)}
        </Link>
      ),
    },
    {
      id: 'type',
      header: 'orders.money.type',
      cell: (entry) => t(`enums.ledgerEntryType.${entry.type}`),
      mobile: 'subtitle',
    },
    { id: 'amount', header: 'orders.money.amount', cell: (entry) => <MoneyText value={entry.amount} />, align: 'end' },
    { id: 'note', header: 'orders.money.note', cell: (entry) => entry.note ?? '—', hideBelow: 'md' },
  ];

  if (entries.isPending) return <PageSkeleton rows={3} />;
  if (entries.isError) return <QueryErrorState error={entries.error} onRetry={() => void entries.refetch()} />;
  return (
    <DataTable
      label={t('customers.tabs.money')}
      columns={columns}
      rows={entries.data.items}
      rowKey={(entry) => entry.id}
      total={entries.data.total}
      page={entries.data.page}
      pageSize={entries.data.pageSize}
      onPageChange={setPage}
      isFetching={entries.isFetching}
      empty={<EmptyState icon={Wallet} title={t('orders.detail.noMoney')} />}
    />
  );
}
