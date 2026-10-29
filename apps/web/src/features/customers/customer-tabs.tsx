import {
  formatNumber,
  hasMoneyReceipt,
  type CustomerHistoryItemDto,
  type LedgerEntryDto,
  type LedgerEntryType,
  type PageDto,
} from '@pallet/shared';
import type { TFunction } from 'i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Ban, HandHelping, History, PackageOpen, Wallet } from 'lucide-react';
import { Undo2 } from '@/components/app/dir-icon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { MoneyText } from '@/components/app/money-text';
import { Pagination } from '@/components/app/pagination';
import { QuantityText } from '@/components/app/quantity-text';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { StatusBadge } from '@/components/app/status-badge';
import { Badge } from '@/components/ui/badge';
import { Tip } from '@/components/app/tip';
import { Button } from '@/components/ui/button';
import { PrintButton } from '@/features/receipt/print-button';
import { orderLabel } from '@/features/orders/order-text';
import { PaymentTypeText } from '@/features/orders/payment-type-text';
import { RelatedOrders } from '@/features/orders/related-orders';
import {
  PrintCustomerReturnReceiptButton,
  PrintMoneyReceiptButton,
} from '@/features/receipt/print-money-receipt-button';
import { invalidateAfterOrderChange } from '@/features/orders/api';
import { apiFetch } from '@/lib/api-client';
import { useCan } from '@/lib/auth';
import { isolate } from '@/lib/bidi';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

/** The customer's orders, with a status choice of their own (§7.3.12). */
export function CustomerOrdersTab({ customerId }: { customerId: number }) {
  const { t } = useTranslation();
  // Keyed: another customer's page starts from their own default status and first page.
  return (
    <RelatedOrders key={customerId} filter={{ customerId }} label={t('customers.tabs.orders')} defaultStatus="OPEN" />
  );
}

/** A customer's payments or refunds, reversals included, across their orders (§7.3.12). */
export function CustomerLedgerTab({ customerId, types }: { customerId: number; types: readonly LedgerEntryType[] }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // The API reads a comma list of types (§6.21).
  const params = { customerId, type: types.join(','), page, pageSize };
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
    { id: 'note', header: 'orders.money.note', cell: (entry) => entry.note ?? '—', hideBelow: 'md', wrap: true },
    {
      id: 'actions',
      header: 'common.actions.title',
      align: 'end',
      // A payment or a refund prints its receipt again, as it was (Q137).
      mobile: 'actions',
      // Null on a reversal row, so its card shows no empty "Actions" (Q66). A customer return's refund prints the
      // visit's one paper, the one the customer was given (Q161); its order's page prints that order's part.
      cell: (entry) =>
        !hasMoneyReceipt(entry.type) ? null : entry.customerReturnId !== null ? (
          <PrintCustomerReturnReceiptButton customerReturnId={entry.customerReturnId} />
        ) : (
          <PrintMoneyReceiptButton entry={entry} />
        ),
    },
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
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      isFetching={entries.isFetching}
      empty={<EmptyState icon={Wallet} title={t('orders.detail.noMoney')} />}
    />
  );
}

const HISTORY_ICONS = { HANDOVER: PackageOpen, RETURN: Undo2, LEDGER: Wallet, PALLET: HandHelping } as const;

/**
 * The customer's timeline (§7.3.12): hand-overs, returns and money rows, newest first, one card each.
 * A deleted or corrected return stays, marked as such.
 */
export function CustomerHistoryTab({ customerId }: { customerId: number }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const params = { page, pageSize };
  const queryClient = useQueryClient();
  const canUndo = useCan('returns.create');
  const [undoing, setUndoing] = useState<Extract<CustomerHistoryItemDto, { kind: 'PALLET' }> | null>(null);
  // The last one asked about, kept while the dialog animates out, so its text never empties as it closes.
  const [lastUndoing, setLastUndoing] = useState<Extract<CustomerHistoryItemDto, { kind: 'PALLET' }> | null>(null);
  if (undoing && undoing !== lastUndoing) setLastUndoing(undoing);
  const undo = useMutation({
    mutationFn: (palletCreditId: number) => apiFetch<void>(`/hand-backs/${palletCreditId}/undo`, { method: 'POST' }),
    onSuccess: () => {
      setUndoing(null);
      toast.success(t('customers.palletCredits.undoDone'));
      void invalidateAfterOrderChange(queryClient);
    },
    onError: (error) => {
      setUndoing(null);
      void invalidateAfterOrderChange(queryClient);
      handleApiError(error);
    },
  });
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
          // Whatever was undone reads faded: a return reversed, an order cancelled, a give-back undone (Q173).
          const muted =
            entry.kind === 'RETURN'
              ? entry.reversed
              : entry.kind === 'HANDOVER'
                ? entry.cancelled
                : entry.kind === 'PALLET'
                  ? entry.undone
                  : false;
          return (
            <li
              key={`${entry.kind}-${historyKey(entry)}`}
              className={cn('bg-card flex gap-3 rounded-lg border p-3', muted && 'opacity-60')}
            >
              <Icon className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{historyTitle(t, entry)}</span>
                  {/* A give-back or a return's extra pallets belong to no order (Q170). */}
                  {entry.orderId !== null && entry.orderNumber !== null ? (
                    <Link
                      to="/orders/$orderId"
                      params={{ orderId: String(entry.orderId) }}
                      dir="ltr"
                      className="text-primary text-sm underline-offset-4 hover:underline"
                    >
                      {orderLabel(entry.orderNumber)}
                    </Link>
                  ) : null}
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
                  {/* A give-back undone is marked; one standing may be undone, if recorded by mistake (Q173). */}
                  {entry.kind === 'PALLET' && entry.reason === 'HAND_BACK' && entry.undone ? (
                    <Badge variant="secondary">
                      <Ban aria-hidden />
                      {t('customers.palletCredits.undone')}
                    </Badge>
                  ) : null}
                  {entry.kind === 'PALLET' && entry.reason === 'HAND_BACK' && !entry.undone && canUndo ? (
                    <Button variant="ghost" size="sm" onClick={() => setUndoing(entry)}>
                      <Undo2 aria-hidden />
                      {t('customers.palletCredits.undo')}
                    </Button>
                  ) : null}
                  {/* A give-back prints its paper again (Q172). */}
                  {entry.kind === 'PALLET' && entry.reason === 'HAND_BACK' ? (
                    <Tip label={t('orders.detail.printReceipt')}>
                      <PrintButton
                        variant="ghost"
                        size="icon"
                        aria-label={t('orders.detail.printReceipt')}
                        request={{ kind: 'hand-back', palletCreditId: entry.palletCreditId }}
                      />
                    </Tip>
                  ) : null}
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
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
      <ConfirmDialog
        open={undoing !== null}
        onOpenChange={(open) => {
          if (!open) setUndoing(null);
        }}
        title={t('customers.palletCredits.undoTitle')}
        description={
          lastUndoing
            ? t('customers.palletCredits.undoBody', {
                quantity: formatNumber(Math.abs(lastUndoing.quantity)),
                item: isolate(lastUndoing.item.name),
              })
            : ''
        }
        confirmLabel={t('customers.palletCredits.undo')}
        pending={undo.isPending}
        onConfirm={() => {
          if (undoing) undo.mutate(undoing.palletCreditId);
        }}
      />
    </div>
  );
}

function historyKey(entry: CustomerHistoryItemDto): number {
  switch (entry.kind) {
    case 'HANDOVER':
      return entry.orderId;
    case 'RETURN':
      return entry.returnId;
    case 'LEDGER':
      return entry.ledgerEntryId;
    case 'PALLET':
      return entry.palletCreditId;
  }
}

function historyTitle(t: TFunction, entry: CustomerHistoryItemDto): string {
  if (entry.kind === 'PALLET') return t(`enums.palletCreditReason.${entry.reason}`);
  if (entry.kind !== 'LEDGER') return t(`enums.customerHistoryKind.${entry.kind}`);
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
  if (entry.kind === 'PALLET') {
    return (
      <p className={line}>
        <span className="text-foreground font-medium">
          <QuantityText value={Math.abs(entry.quantity)} /> × <bdi>{entry.item.name}</bdi>
        </span>
        {entry.note ? <bdi>{entry.note}</bdi> : null}
      </p>
    );
  }
  return (
    <p className={line}>
      <span className="text-foreground font-medium">
        <MoneyText value={entry.amount} />
      </span>
      {entry.isAutomatic ? <span>{t('payments.automatic')}</span> : null}
      {entry.note ? <bdi>{entry.note}</bdi> : null}
    </p>
  );
}
