import {
  formatOrderNumber,
  hasMoneyReceipt,
  type LedgerEntryDto,
  type OrderDetailDto,
  type ReturnDto,
} from '@pallet/shared';
import { ArrowDownLeft, ArrowUpRight, Ban, Printer, Trash2 } from 'lucide-react';
import { Undo2 } from '@/components/app/dir-icon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { FilterChoice } from '@/components/app/list-controls';
import { MoneyText } from '@/components/app/money-text';
import { QuantityText } from '@/components/app/quantity-text';
import { EmptyState } from '@/components/app/states';
import { Thumbnail } from '@/components/app/thumbnail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/app/tip';
import { printTransactionsReceipt } from '@/features/receipt/print-receipt';
import { isStandingRefundOf } from '@/features/returns/return-math';
import {
  PrintCustomerReturnReceiptButton,
  PrintReturnButtons,
  PrintMoneyReceiptButton,
} from '@/features/receipt/print-money-receipt-button';
import { scrollToAnchor } from '@/lib/scroll-to-anchor';
import { cn } from '@/lib/utils';
import { ActorName } from '@/components/app/actor-name';
import { ItemName } from '@/components/app/item-name';
import { NoteText } from '@/components/app/note-text';

type Line = OrderDetailDto['lines'][number];

const LINE_COLUMNS: DataColumn<Line>[] = [
  {
    id: 'item',
    header: 'orders.lines.item',
    cell: (line) => (
      <span className="flex items-center gap-3">
        <Thumbnail url={line.item.imageUrl} />
        <ItemName name={line.item.name} />
      </span>
    ),
    wrap: true,
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
      empty={null}
    />
  );
}

/** A damaged count, in red when there is one. */
function DamagedCount({ value }: { value: number }) {
  return (
    <span className={cn(value > 0 && 'text-destructive font-medium')}>
      <QuantityText value={value} />
    </span>
  );
}

/** One line per returned item, the same height in every column, so a return's items read across the row. */
function ReturnLines({
  pr,
  cell,
  end = false,
}: {
  pr: ReturnDto;
  cell: (line: ReturnDto['lines'][number]) => React.ReactNode;
  /** Numbers sit at the column's end, as its header does. */
  end?: boolean;
}) {
  return (
    <ul className="flex flex-col">
      {pr.lines.map((line) => (
        <li key={line.id} className={cn('flex h-8 items-center whitespace-nowrap', end && 'justify-end')}>
          {cell(line)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The order's returns as a table, newest first; reversed ones only when asked for (§7.3.6). Each return is a
 * row whose item, accepted and damaged cells list its items line by line. A standing return prints its receipt
 * (Q166) and offers its edit and delete when `actions` allows them (Q54); a corrected one links to the return that
 * replaced it.
 */
export function OrderReturns({
  returns,
  ledgerEntries,
  actions,
}: {
  returns: ReturnDto[];
  ledgerEntries: LedgerEntryDto[];
  actions?: { edit?: (pr: ReturnDto) => React.ReactNode; onDelete?: (pr: ReturnDto) => void };
}) {
  const { t } = useTranslation();
  const [showReversed, setShowReversed] = useState(false);
  const visible = [...returns].reverse().filter((pr) => showReversed || !pr.reversed);
  // Most returns refund nothing for damage: the column shows only when one of them does — any of them, so
  // "Show reversed" never adds or takes away a column.
  const hasDamagedRefund = returns.some((pr) => pr.lines.some((line) => line.damagedRefund > 0));

  const columns: DataColumn<ReturnDto>[] = [
    {
      id: 'date',
      header: 'orders.money.date',
      cell: (pr) => (
        <span className="flex flex-wrap items-center gap-2">
          <span dir="ltr" className="text-muted-foreground">
            #{formatOrderNumber(pr.id)}
          </span>
          <DateText value={pr.date} />
          {pr.reversed ? (
            <Badge variant="secondary">
              <Ban aria-hidden />
              {t('orders.detail.reversed')}
            </Badge>
          ) : null}
          {pr.replacedByReturnId ? (
            <button
              type="button"
              className="text-primary text-sm underline-offset-4 hover:underline"
              // Scrolls to the replacement's row or card, whichever this width shows; no hash for the router to keep.
              onClick={() => scrollToAnchor(`return-${pr.replacedByReturnId}`)}
            >
              {t('orders.detail.replacedBy', { id: pr.replacedByReturnId })}
            </button>
          ) : null}
        </span>
      ),
      mobile: 'title',
    },
    {
      id: 'item',
      header: 'orders.lines.item',
      cell: (pr) => (
        <ReturnLines
          pr={pr}
          cell={(line) => (
            // A long name is cut, not wrapped: each line must stay the height of its counts beside it.
            <bdi className="block max-w-60 truncate font-medium" title={line.item.name}>
              {line.item.name}
            </bdi>
          )}
        />
      ),
      // On a card the item and its counts share a line: three narrow columns do not fit.
      mobileCell: (pr) => (
        <ul className="flex flex-col gap-1">
          {pr.lines.map((line) => (
            <li key={line.id} className="flex flex-wrap gap-x-4">
              <ItemName name={line.item.name} className="font-medium" />
              <span>
                {t('orders.detail.returnAccepted')}: <QuantityText value={line.acceptedQuantity} />
              </span>
              <span>
                {t('orders.detail.returnDamaged')}: <DamagedCount value={line.damagedQuantity} />
              </span>
              {line.damagedRefund > 0 ? (
                <span>
                  {t('orders.detail.damagedRefund')}: <MoneyText value={line.damagedRefund} />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ),
      mobile: 'subtitle',
    },
    {
      id: 'accepted',
      header: 'orders.detail.returnAccepted',
      cell: (pr) => <ReturnLines pr={pr} end cell={(line) => <QuantityText value={line.acceptedQuantity} />} />,
      align: 'end',
      mobile: 'hidden',
    },
    {
      id: 'damaged',
      header: 'orders.detail.returnDamaged',
      cell: (pr) => <ReturnLines pr={pr} end cell={(line) => <DamagedCount value={line.damagedQuantity} />} />,
      align: 'end',
      mobile: 'hidden',
    },
    ...(hasDamagedRefund
      ? [
          {
            id: 'damagedRefund',
            header: 'orders.detail.damagedRefund',
            cell: (pr: ReturnDto) =>
              pr.lines.some((line) => line.damagedRefund > 0) ? (
                <ReturnLines
                  pr={pr}
                  end
                  cell={(line) => (line.damagedRefund > 0 ? <MoneyText value={line.damagedRefund} /> : '—')}
                />
              ) : (
                '—'
              ),
            align: 'end',
            // On a card each refund sits on its item's line instead.
            mobile: 'hidden',
          } satisfies DataColumn<ReturnDto>,
        ]
      : []),
    {
      id: 'refundDue',
      header: 'orders.detail.refundDue',
      cell: (pr) => <MoneyText value={pr.refundDue} />,
      align: 'end',
      mobile: 'figure',
    },
    {
      id: 'cashRefund',
      header: 'orders.detail.cashRefund',
      cell: (pr) => <MoneyText value={pr.cashRefund} />,
      align: 'end',
      mobile: 'figure',
    },
    {
      id: 'notes',
      header: 'orders.money.note',
      // Two lines at most; the return's edit form shows it whole (Q165).
      cell: (pr) => (pr.notes ? <NoteText text={pr.notes} /> : '—'),
      mobileCell: (pr) => (pr.notes ? <NoteText text={pr.notes} /> : null),
      wrap: true,
      mobile: 'meta',
    },
    {
      id: 'createdBy',
      header: 'orders.money.createdBy',
      cell: (pr) => (
        <span className="flex flex-col">
          <ActorName user={pr.createdBy} />
          <span className="text-muted-foreground text-sm">
            <DateText value={pr.createdAt} withTime />
          </span>
        </span>
      ),
      mobileCell: (pr) => (
        <span>
          <ActorName user={pr.createdBy} /> · <DateText value={pr.createdAt} withTime />
        </span>
      ),
      wrap: true,
      mobile: 'footer',
    },
    {
      id: 'actions',
      header: 'common.actions.title',
      align: 'end',
      mobile: 'actions',
      // Nothing on a reversed return, so its card shows no empty "Actions" (Q66).
      cell: (pr: ReturnDto) =>
        pr.reversed ? null : (
          <div className="flex items-center justify-end gap-1">
            <PrintReturnReceiptButton pr={pr} ledgerEntries={ledgerEntries} />
            {actions?.edit?.(pr)}
            {actions?.onDelete ? (
              <Tip label={t('orders.detail.deleteReturn')}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('orders.detail.deleteReturn')}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => actions.onDelete?.(pr)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </Tip>
            ) : null}
          </div>
        ),
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('orders.detail.returns')}</h2>
        {returns.some((pr) => pr.reversed) ? (
          <FilterChoice
            label={t('orders.detail.showReversed')}
            offLabel={t('orders.detail.hideReversed')}
            checked={showReversed}
            onCheckedChange={setShowReversed}
          />
        ) : null}
      </div>
      <DataTable
        label={t('orders.detail.returns')}
        columns={columns}
        rows={visible}
        rowKey={(pr) => pr.id}
        rowAnchor={(pr) => `return-${pr.id}`}
        rowMuted={(pr) => pr.reversed}
        empty={<EmptyState icon={Undo2} title={t('orders.detail.noReturns')} />}
      />
    </section>
  );
}

/**
 * The order's money rows ("Transactions", Q139) in recording order; reversals are rows of their own (§7.3.6). A
 * payment or a refund prints its receipt (Q137), and all of them print together on one paper (Q139); a manual
 * payment that stands offers its deletion when `onDeletePayment` is given.
 */
export function OrderMoney({
  orderId,
  entries,
  onDeletePayment,
}: {
  orderId: number;
  entries: LedgerEntryDto[];
  onDeletePayment?: (entry: LedgerEntryDto) => void;
}) {
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
      // A reversal names the row it reverses and keeps the note it was given.
      cell: (entry) => (
        <span className="flex flex-col">
          {entry.reversesEntryId ? (
            <span className="text-muted-foreground">{t('orders.money.reverses', { id: entry.reversesEntryId })}</span>
          ) : null}
          {entry.note ? <bdi>{entry.note}</bdi> : entry.reversesEntryId ? null : '—'}
        </span>
      ),
      hideBelow: 'md',
      wrap: true,
    },
    {
      id: 'createdBy',
      header: 'orders.money.createdBy',
      cell: (entry) => <ActorName user={entry.createdBy} />,
      hideBelow: 'lg',
      wrap: true,
    },
    {
      id: 'actions',
      header: 'common.actions.title',
      align: 'end',
      mobile: 'actions',
      // Nothing at all on a row with nothing to offer, so a card shows no empty "Actions" (Q66).
      cell: (entry) =>
        !hasMoneyReceipt(entry.type) && !(onDeletePayment && entry.canReverse) ? null : (
          <div className="flex items-center justify-end gap-1">
            <PrintMoneyReceiptButton entry={entry} />
            {/* This order's part prints above; the visit's one paper over all its orders, beside it (Q161). */}
            <PrintCustomerReturnReceiptButton customerReturnId={entry.customerReturnId} />
            {onDeletePayment && entry.canReverse ? (
              <Button variant="outline" size="sm" onClick={() => onDeletePayment(entry)}>
                <Trash2 aria-hidden />
                {t('orders.detail.deletePayment')}
              </Button>
            ) : null}
          </div>
        ),
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('orders.detail.money')}</h2>
        {entries.some((entry) => hasMoneyReceipt(entry.type)) ? (
          <Button variant="outline" size="sm" onClick={() => printTransactionsReceipt(orderId)}>
            <Printer aria-hidden />
            {t('orders.money.printAll')}
          </Button>
        ) : null}
      </div>
      <DataTable
        label={t('orders.detail.money')}
        columns={columns}
        rows={entries}
        rowKey={(entry) => entry.id}
        empty={<EmptyState title={t('orders.detail.noMoney')} />}
      />
    </section>
  );
}

/** A standing return's printers (`PrintReturnButtons`), its refund found among the order's money rows. */
function PrintReturnReceiptButton({ pr, ledgerEntries }: { pr: ReturnDto; ledgerEntries: LedgerEntryDto[] }) {
  const refund = ledgerEntries.find((entry) => isStandingRefundOf(entry, pr.id));
  return (
    <PrintReturnButtons returnId={pr.id} refundEntryId={refund?.id ?? null} customerReturnId={pr.customerReturnId} />
  );
}

/**
 * Pallets the factory owed the customer, handed over with this order and no deposit (Q170): a note in the warning's
 * colour saying so, and a table of them like the order's own lines. Nothing while there are none.
 */
export function OrderFromCredit({ fromCredit }: { fromCredit: OrderDetailDto['fromCredit'] }) {
  const { t } = useTranslation();
  // Read with `??`: an order answer stored before Q170 and replayed for its key has no such field.
  const rows = fromCredit ?? [];
  if (rows.length === 0) return null;
  const columns: DataColumn<OrderDetailDto['fromCredit'][number]>[] = [
    {
      id: 'item',
      header: 'orders.lines.item',
      cell: (entry) => (
        <span className="flex items-center gap-3">
          <Thumbnail url={entry.item.imageUrl} />
          <ItemName name={entry.item.name} />
        </span>
      ),
      wrap: true,
    },
    {
      id: 'quantity',
      header: 'orders.lines.quantity',
      cell: (entry) => <QuantityText value={entry.quantity} />,
      align: 'end',
    },
  ];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('orders.detail.fromCreditTitle')}</h2>
      <p className="bg-warning/12 text-warning rounded-md p-3 text-sm font-semibold dark:bg-warning/20">
        {t('orders.detail.fromCreditNote')}
      </p>
      <DataTable
        label={t('orders.detail.fromCreditTitle')}
        columns={columns}
        rows={rows}
        rowKey={(entry) => entry.item.id}
        empty={null}
      />
    </section>
  );
}
