import type { AuditLogDto } from '@pallet/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { dynamicKey } from '@/i18n/keys';
import { translateSummaryParams } from '@/lib/audit-summary';
import { useAuth, useCan } from '@/lib/auth';
import { AuditDiff } from './audit-diff';

const LINK = 'text-primary underline-offset-4 hover:underline';

/** The order a return or ledger row belongs to, read from its snapshot (§11.4). */
function owningOrderId(row: AuditLogDto): string | null {
  for (const snapshot of [row.after, row.before]) {
    if (snapshot && typeof snapshot === 'object' && 'orderId' in snapshot) {
      const { orderId } = snapshot as { orderId: unknown };
      if (typeof orderId === 'number' || typeof orderId === 'string') return String(orderId);
    }
  }
  return null;
}

/** The record a row is about, linked only when the viewer may open its page (§7.3.18). */
export function EntityRef({ row }: { row: AuditLogDto }) {
  const { t } = useTranslation();
  const isAdmin = useAuth().user?.role === 'ADMIN';
  const canViewItems = useCan('items.view');
  const canViewCustomers = useCan('customers.view');
  const canViewOrders = useCan('orders.view');
  const label = t(`enums.auditEntityType.${row.entityType}`);
  if (!row.entityId) return <>{label}</>;

  const id = row.entityId;
  // A session's id is a uuid: it must be allowed to break, or it pushes a phone's layout sideways.
  const text = (
    <span dir="ltr" className="break-all">
      #{id}
    </span>
  );
  const orderId =
    row.entityType === 'ORDER'
      ? id
      : row.entityType === 'RETURN' || row.entityType === 'LEDGER_ENTRY'
        ? owningOrderId(row)
        : null;
  // Drivers have no page of their own: they are edited in a dialog on their list.
  const target =
    row.entityType === 'ITEM' && canViewItems ? (
      <Link to="/items/$itemId" params={{ itemId: id }} className={LINK}>
        {text}
      </Link>
    ) : row.entityType === 'CUSTOMER' && canViewCustomers ? (
      <Link to="/customers/$customerId" params={{ customerId: id }} className={LINK}>
        {text}
      </Link>
    ) : row.entityType === 'USER' && isAdmin ? (
      <Link to="/users/$userId" params={{ userId: id }} className={LINK}>
        {text}
      </Link>
    ) : orderId && canViewOrders ? (
      <Link to="/orders/$orderId" params={{ orderId }} className={LINK}>
        {text}
      </Link>
    ) : (
      text
    );

  return (
    <span>
      {label} {target}
    </span>
  );
}

/** Who did it; a failed sign-in has no user, only the name that was tried. */
export function AuditUser({ row }: { row: AuditLogDto }) {
  return row.user ? (
    <bdi>{row.user.displayName}</bdi>
  ) : (
    <bdi className="text-muted-foreground italic">{row.usernameAttempt ?? '—'}</bdi>
  );
}

/** The entry's summary, which opens the before/after comparison below it. */
export function AuditSummary({
  row,
  expanded,
  onToggle,
}: {
  row: AuditLogDto;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className="min-h-10 text-start underline-offset-4 hover:underline md:min-h-0"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {t(dynamicKey(row.summaryKey), translateSummaryParams(t, row.summaryParams))}
      </button>
      {expanded ? <AuditDiff row={row} /> : null}
    </div>
  );
}
