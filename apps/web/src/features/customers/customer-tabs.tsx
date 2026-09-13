import type {
  CustomerHistoryItemDto,
  LedgerEntryDto,
  LedgerEntryType,
  OrderListItemDto,
  PageDto,
} from '@pallet/shared';
import type { TFunction } from 'i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Ban, ClipboardList, History, PackageOpen, Undo2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { MoneyText } from '@/components/app/money-text';
import { Pagination } from '@/components/app/pagination';
import { QuantityText } from '@/components/app/quantity-text';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { StatusBadge } from '@/components/app/status-badge';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ORDER_COLUMNS } from '@/features/orders/order-columns';
import { orderLabel } from '@/features/orders/order-text';
import { PaymentTypeText } from '@/features/orders/payment-type-text';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

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

const HISTORY_ICONS = { HANDOVER: PackageOpen, RETURN: Undo2, LEDGER: Wallet } as const;

/**
 * The customer's timeline (§7.3.12): hand-overs, returns and money rows, newest first, one card each.
 * A deleted or corrected return stays, marked as such.
 */
export function CustomerHistoryTab({ customerId }: { customerId: number }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 25 };
  const history = useQuery({
    queryKey: qk.customers.history(customerId, params),
    queryFn: () => apiFetch<PageDto<CustomerHistoryItemDto>>(`/customers/${customerId}/history`, { query: params }),
    placeholderData: keepPreviousData,
  });

  if (history.isPending) return <PageSkeleton rows={3} />;
  if (history.isError) return <QueryErrorState error={history.error} onRetry={() => void history.refetch()} />;
  if (history.data.total === 0) return <EmptyState icon={History} title={t('customers.history.empty')} />;

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={t('customers.tabs.history')} className="flex flex-col gap-2">
        {history.data.items.map((entry) => {
          const Icon = HISTORY_ICONS[entry.kind];
          const muted = entry.kind === 'RETURN' ? entry.reversed : entry.kind === 'HANDOVER' ? entry.cancelled : false;
          return (
            <li
              key={`${entry.kind}-${entry.kind === 'HANDOVER' ? entry.orderId : entry.kind === 'RETURN' ? entry.returnId : entry.ledgerEntryId}`}
              className={cn('bg-card flex gap-3 rounded-lg border p-3', muted && 'opacity-60')}
            >
              <Icon className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{historyTitle(t, entry)}</span>
                  <Link
                    to="/orders/$orderId"
                    params={{ orderId: String(entry.orderId) }}
                    dir="ltr"
                    className="text-primary text-sm underline-offset-4 hover:underline"
                  >
                    {orderLabel(entry.orderNumber)}
                  </Link>
                  {entry.kind === 'RETURN' && entry.reversed ? (
                    <Badge variant="secondary">
                      <Ban aria-hidden />
                      {t(entry.reversalKind === 'EDIT' ? 'customers.history.corrected' : 'customers.history.deleted')}
                    </Badge>
                  ) : null}
                  {entry.kind === 'HANDOVER' && entry.cancelled ? <StatusBadge status="CANCELLED" /> : null}
                  <span className="text-muted-foreground ms-auto text-sm">
                    <DateText value={entry.date} />
                  </span>
                </div>
                <HistoryDetail entry={entry} />
              </div>
            </li>
          );
        })}
      </ul>
      <Pagination
        page={history.data.page}
        pageSize={history.data.pageSize}
        total={history.data.total}
        onPageChange={setPage}
      />
    </div>
  );
}

function historyTitle(t: TFunction, entry: CustomerHistoryItemDto): string {
  if (entry.kind === 'HANDOVER') return t('customers.history.handover');
  if (entry.kind === 'RETURN') return t('customers.history.return');
  return t(`enums.ledgerEntryType.${entry.type}`);
}

function HistoryDetail({ entry }: { entry: CustomerHistoryItemDto }) {
  const { t } = useTranslation();
  const line = 'text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm';
  if (entry.kind === 'HANDOVER') {
    return (
      <p className={line}>
        <span>
          {t('customers.history.pallets')}: <QuantityText value={entry.quantityTotal} />
        </span>
        <span>
          {t('orders.fields.depositTotal')}: <MoneyText value={entry.depositTotal} />
        </span>
        <PaymentTypeText type={entry.paymentType} />
      </p>
    );
  }
  if (entry.kind === 'RETURN') {
    return (
      <p className={line}>
        <span>
          {t('orders.detail.returnAccepted')}: <QuantityText value={entry.acceptedTotal} />
        </span>
        <span>
          {t('orders.detail.returnDamaged')}: <QuantityText value={entry.damagedTotal} />
        </span>
        <span>
          {t('orders.detail.refundDue')}: <MoneyText value={entry.refundDue} />
        </span>
        {entry.cashRefund > 0 ? (
          <span>
            {t('orders.detail.cashRefund')}: <MoneyText value={entry.cashRefund} />
          </span>
        ) : null}
      </p>
    );
  }
  return (
    <p className={line}>
      <span className="text-foreground font-medium">
        <MoneyText value={entry.amount} />
      </span>
      {entry.isAutomatic ? <span>{t('payments.automatic')}</span> : null}
      {entry.note ? <span>{entry.note}</span> : null}
    </p>
  );
}
