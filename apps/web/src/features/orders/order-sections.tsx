import type { LedgerEntryDto, OrderDetailDto, ReturnDto } from '@pallet/shared';
import { ArrowDownLeft, ArrowUpRight, Ban, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { FilterSwitch } from '@/components/app/list-controls';
import { MoneyText } from '@/components/app/money-text';
import { QuantityText } from '@/components/app/quantity-text';
import { EmptyState } from '@/components/app/states';
import { Thumbnail } from '@/components/app/thumbnail';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Line = OrderDetailDto['lines'][number];

const LINE_COLUMNS: DataColumn<Line>[] = [
  {
    id: 'item',
    header: 'orders.lines.item',
    cell: (line) => (
      <span className="flex items-center gap-3">
        <Thumbnail url={line.item.imageUrl} />
        {line.item.name}
      </span>
    ),
  },
  {
    id: 'quantity',
    header: 'orders.lines.quantity',
    cell: (line) => <QuantityText value={line.quantity} />,
    align: 'end',
  },
  {
    id: 'unitDeposit',
    header: 'orders.lines.unitDeposit',
    cell: (line) => <MoneyText value={line.unitDeposit} />,
    align: 'end',
  },
  {
    id: 'lineTotal',
    header: 'orders.lines.lineTotal',
    cell: (line) => <MoneyText value={line.lineTotal} />,
    align: 'end',
  },
  {
    id: 'returnedAccepted',
    header: 'orders.lines.returnedAccepted',
    cell: (line) => <QuantityText value={line.returnedAccepted} />,
    align: 'end',
    hideBelow: 'lg',
  },
  {
    id: 'returnedDamaged',
    header: 'orders.lines.returnedDamaged',
    cell: (line) => <QuantityText value={line.returnedDamaged} />,
    align: 'end',
    hideBelow: 'lg',
  },
  {
    id: 'outQuantity',
    header: 'orders.lines.outQuantity',
    cell: (line) => <QuantityText value={line.outQuantity} />,
    align: 'end',
  },
];

export function OrderLinesTable({ order }: { order: OrderDetailDto }) {
  const { t } = useTranslation();
  return (
    <DataTable
      label={t('orders.lines.title')}
      columns={LINE_COLUMNS}
      rows={order.lines}
      rowKey={(line) => line.id}
      total={order.lines.length}
      page={1}
      pageSize={Math.max(order.lines.length, 1)}
      onPageChange={() => undefined}
      empty={null}
    />
  );
}

/** One card per return, newest first; reversed ones only when asked for (§7.3.6). */
export function OrderReturns({ returns }: { returns: ReturnDto[] }) {
  const { t } = useTranslation();
  const [showReversed, setShowReversed] = useState(false);
  const visible = [...returns].reverse().filter((pr) => showReversed || !pr.reversed);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('orders.detail.returns')}</h2>
        {returns.some((pr) => pr.reversed) ? (
          <FilterSwitch
            id="showReversed"
            label={t('orders.detail.showReversed')}
            checked={showReversed}
            onCheckedChange={setShowReversed}
          />
        ) : null}
      </div>
      {visible.length === 0 ? (
        <EmptyState icon={Undo2} title={t('orders.detail.noReturns')} />
      ) : (
        visible.map((pr) => (
          <Card key={pr.id} className={pr.reversed ? 'opacity-60' : undefined}>
            <CardHeader className="flex flex-row flex-wrap items-center gap-2">
              <CardTitle className="text-base">
                <DateText value={pr.date} />
              </CardTitle>
              {pr.reversed ? (
                <Badge variant="secondary">
                  <Ban aria-hidden />
                  {t('orders.detail.reversed')}
                </Badge>
              ) : null}
              {pr.replacedByReturnId ? (
                <span className="text-muted-foreground text-sm">
                  {t('orders.detail.replacedBy', { id: pr.replacedByReturnId })}
                </span>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <ul className="flex flex-col gap-1">
                {pr.lines.map((line) => (
                  <li key={line.id} className="flex flex-wrap gap-x-4">
                    <span className="font-medium">{line.item.name}</span>
                    <span>
                      {t('orders.detail.returnAccepted')}: <QuantityText value={line.acceptedQuantity} />
                    </span>
                    <span>
                      {t('orders.detail.returnDamaged')}: <QuantityText value={line.damagedQuantity} />
                    </span>
                    {line.damagedRefund > 0 ? (
                      <span>
                        {t('orders.detail.damagedRefund')}: <MoneyText value={line.damagedRefund} />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-x-6">
                <span>
                  {t('orders.detail.refundDue')}: <MoneyText value={pr.refundDue} />
                </span>
                <span>
                  {t('orders.detail.cashRefund')}: <MoneyText value={pr.cashRefund} />
                </span>
              </div>
              {pr.notes ? <p className="text-muted-foreground">{pr.notes}</p> : null}
              <p className="text-muted-foreground text-xs">
                {pr.createdBy.displayName} · <DateText value={pr.createdAt} withTime />
              </p>
            </CardContent>
          </Card>
        ))
      )}
    </section>
  );
}

/** The order's money rows in recording order; reversals are rows of their own (§7.3.6). */
export function OrderMoney({ entries }: { entries: LedgerEntryDto[] }) {
  const { t } = useTranslation();
  const columns: DataColumn<LedgerEntryDto>[] = [
    { id: 'effectiveDate', header: 'orders.money.date', cell: (entry) => <DateText value={entry.effectiveDate} /> },
    {
      id: 'type',
      header: 'orders.money.type',
      cell: (entry) => {
        const outgoing = entry.type === 'REFUND' || entry.type === 'PAYMENT_REVERSAL';
        const Icon = outgoing ? ArrowUpRight : ArrowDownLeft;
        return (
          <span className="flex flex-wrap items-center gap-2">
            <Icon className="size-4" aria-hidden />
            {t(`enums.ledgerEntryType.${entry.type}`)}
            {entry.isAutomatic ? <Badge variant="outline">{t('payments.automatic')}</Badge> : null}
          </span>
        );
      },
      mobile: 'title',
    },
    {
      id: 'source',
      header: 'orders.money.source',
      cell: (entry) => t(`enums.ledgerEntrySource.${entry.source}`),
      hideBelow: 'md',
    },
    { id: 'amount', header: 'orders.money.amount', cell: (entry) => <MoneyText value={entry.amount} />, align: 'end' },
    {
      id: 'note',
      header: 'orders.money.note',
      cell: (entry) =>
        entry.reversesEntryId ? (
          <span className="text-muted-foreground">{t('orders.money.reverses', { id: entry.reversesEntryId })}</span>
        ) : (
          (entry.note ?? '—')
        ),
      hideBelow: 'md',
    },
    {
      id: 'createdBy',
      header: 'orders.money.createdBy',
      cell: (entry) => entry.createdBy.displayName,
      hideBelow: 'lg',
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('orders.detail.money')}</h2>
      <DataTable
        label={t('orders.detail.money')}
        columns={columns}
        rows={entries}
        rowKey={(entry) => entry.id}
        total={entries.length}
        page={1}
        pageSize={Math.max(entries.length, 1)}
        onPageChange={() => undefined}
        empty={<EmptyState title={t('orders.detail.noMoney')} />}
      />
    </section>
  );
}
