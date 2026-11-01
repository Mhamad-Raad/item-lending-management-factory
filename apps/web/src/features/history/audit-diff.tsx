import { formatBusinessDate, formatNumber, formatOrderNumber, formatTimestamp, type AuditLogDto } from '@pallet/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MoneyText } from '@/components/app/money-text';
import { dynamicKey } from '@/i18n/keys';

type Snapshot = Record<string, unknown>;

const ORDER_KEYS = new Set([
  'orderNumber',
  'customerId',
  'driverId',
  'date',
  'paymentType',
  'status',
  'lines',
  'fromCredit',
  'notes',
]);

/** Before and after, side by side; the server has already removed anything the viewer may not see. */
export function AuditDiff({ row }: { row: AuditLogDto }) {
  const { t } = useTranslation();
  const before = (row.before ?? {}) as Snapshot;
  const after = (row.after ?? {}) as Snapshot;
  // An order's own fields in words (Q181); its other rows — a credit override's figures — as they are.
  if (
    row.entityType === 'ORDER' &&
    [...Object.keys(before), ...Object.keys(after)].some((key) => ORDER_KEYS.has(key))
  ) {
    return <OrderDiff before={before} after={after} />;
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (keys.length === 0) return null;

  return (
    <div className="bg-muted/40 grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 rounded-md p-3 text-xs">
      <span className="font-medium">{t('history.diff.field')}</span>
      <span className="font-medium">{t('history.diff.before')}</span>
      <span className="font-medium">{t('history.diff.after')}</span>
      {keys.map((key) => {
        const changed = JSON.stringify(before[key]) !== JSON.stringify(after[key]);
        return (
          <div key={key} className="contents">
            <span className={changed ? 'font-medium' : 'text-muted-foreground'}>
              {changed ? '• ' : ''}
              {key}
            </span>
            <pre className="overflow-x-auto whitespace-pre-wrap">
              <bdi dir="ltr">{JSON.stringify(before[key] ?? null)}</bdi>
            </pre>
            <pre className="overflow-x-auto whitespace-pre-wrap">
              <bdi dir="ltr">{JSON.stringify(after[key] ?? null)}</bdi>
            </pre>
          </div>
        );
      })}
    </div>
  );
}

/** An item a snapshot names (Q181); a row written before names were kept shows its number. */
function itemLabel(row: Snapshot): ReactNode {
  return typeof row['itemName'] === 'string' ? <bdi>{row['itemName']}</bdi> : `#${String(row['itemId'])}`;
}

/** A list of an order's pallets, one per line: the item, how many, and — for a lent line — × the deposit each. */
function PalletList({ rows }: { rows: unknown }) {
  if (!Array.isArray(rows) || rows.length === 0) return <>—</>;
  return (
    <ul className="flex flex-col gap-0.5">
      {(rows as Snapshot[]).map((row, index) => (
        <li key={index}>
          {itemLabel(row)}: <span dir="ltr">{formatNumber(Number(row['quantity']))}</span>
          {typeof row['unitDeposit'] === 'number' ? (
            <>
              {' '}
              × <MoneyText value={row['unitDeposit']} />
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * An order's history row in words (Q181): each field under its own label, items and drivers by name, dates, money
 * and the payment type as the order page shows them — what was there before and what is there after.
 */
function OrderDiff({ before, after }: { before: Snapshot; after: Snapshot }) {
  const { t } = useTranslation();
  const name = (snapshot: Snapshot, nameKey: string, idKey: string): ReactNode =>
    typeof snapshot[nameKey] === 'string' ? (
      <bdi>{snapshot[nameKey]}</bdi>
    ) : snapshot[idKey] === undefined ? (
      '—'
    ) : (
      `#${String(snapshot[idKey])}`
    );
  const fields: { keys: string[]; label: string; show: (snapshot: Snapshot) => ReactNode }[] = [
    {
      keys: ['orderNumber'],
      label: t('orders.fields.orderNumber'),
      show: (s) => (typeof s['orderNumber'] === 'number' ? formatOrderNumber(s['orderNumber']) : '—'),
    },
    {
      keys: ['customerId', 'customerName'],
      label: t('orders.fields.customer'),
      show: (s) => name(s, 'customerName', 'customerId'),
    },
    {
      keys: ['driverId', 'driverName'],
      label: t('orders.fields.driver'),
      show: (s) => name(s, 'driverName', 'driverId'),
    },
    {
      keys: ['date'],
      label: t('orders.fields.date'),
      show: (s) => (typeof s['date'] === 'string' ? formatBusinessDate(s['date']) : '—'),
    },
    {
      keys: ['paymentType'],
      label: t('orders.fields.paymentType'),
      show: (s) =>
        typeof s['paymentType'] === 'string' ? t(dynamicKey(`enums.paymentType.${s['paymentType']}`)) : '—',
    },
    {
      keys: ['status'],
      label: t('orders.fields.status'),
      show: (s) => (typeof s['status'] === 'string' ? t(dynamicKey(`enums.orderStatus.${s['status']}`)) : '—'),
    },
    {
      keys: ['depositTotal'],
      label: t('orders.fields.depositTotal'),
      show: (s) => (typeof s['depositTotal'] === 'number' ? <MoneyText value={s['depositTotal']} /> : '—'),
    },
    { keys: ['lines'], label: t('orders.lines.title'), show: (s) => <PalletList rows={s['lines']} /> },
    {
      keys: ['fromCredit'],
      label: t('orders.detail.fromCreditTitle'),
      show: (s) => <PalletList rows={s['fromCredit']} />,
    },
    {
      keys: ['creditOverrideByUserId'],
      label: t('history.orderFields.creditOverrideBy'),
      show: (s) => (typeof s['creditOverrideByUserId'] === 'number' ? `#${String(s['creditOverrideByUserId'])}` : '—'),
    },
    {
      keys: ['creditOverrideAt'],
      label: t('history.orderFields.creditOverrideAt'),
      show: (s) => (typeof s['creditOverrideAt'] === 'string' ? formatTimestamp(s['creditOverrideAt']) : '—'),
    },
    {
      keys: ['cancelledAt'],
      label: t('history.orderFields.cancelledAt'),
      show: (s) => (typeof s['cancelledAt'] === 'string' ? formatTimestamp(s['cancelledAt']) : '—'),
    },
    {
      keys: ['notes'],
      label: t('orders.fields.notes'),
      show: (s) =>
        typeof s['notes'] === 'string' && s['notes'] !== '' ? (
          <bdi className="whitespace-pre-wrap">{s['notes']}</bdi>
        ) : (
          '—'
        ),
    },
  ];
  // Anything else the row keeps — a credit override's who and when, a cancel's time — as it is, under its own key; the
  // ids the names above stand for are left out.
  const shown = new Set([...fields.flatMap((field) => field.keys), 'id', 'version']);
  const rest = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !shown.has(key));
  const raw = (snapshot: Snapshot, key: string) => (
    <bdi dir="ltr" className="break-all">
      {JSON.stringify(snapshot[key] ?? null)}
    </bdi>
  );
  const present = [
    ...fields.filter((field) => field.keys.some((key) => key in before || key in after)),
    ...rest.map((key) => ({ keys: [key], label: key, show: (snapshot: Snapshot) => raw(snapshot, key) })),
  ];
  if (present.length === 0) return null;
  const hasBefore = Object.keys(before).length > 0;

  return (
    <div
      className={`bg-muted/40 grid gap-x-4 gap-y-1 rounded-md p-3 text-xs ${hasBefore ? 'grid-cols-[auto_1fr_1fr]' : 'grid-cols-[auto_1fr]'}`}
    >
      <span className="font-medium">{t('history.diff.field')}</span>
      {hasBefore ? <span className="font-medium">{t('history.diff.before')}</span> : null}
      <span className="font-medium">{t('history.diff.after')}</span>
      {present.map((field) => {
        const changed = field.keys.some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
        return (
          <div key={field.label} className="contents">
            <span className={changed && hasBefore ? 'font-medium' : 'text-muted-foreground'}>
              {changed && hasBefore ? '• ' : ''}
              {field.label}
            </span>
            {hasBefore ? <div>{field.show(before)}</div> : null}
            <div>{field.show(after)}</div>
          </div>
        );
      })}
    </div>
  );
}
