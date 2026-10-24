import type { AuditLogDto } from '@pallet/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { dynamicKey } from '@/i18n/keys';
import { translateSummaryParams } from '@/lib/audit-summary';
import { useAuth, useCan } from '@/lib/auth';
import { AuditDiff } from './audit-diff';
import { ActorName } from '@/components/app/actor-name';

const LINK = 'text-primary underline-offset-4 hover:underline';

/** The order a return or ledger row belongs to, or the customer of a customer return, read from its snapshot (§11.4). */
function owningId(row: AuditLogDto, field: 'orderId' | 'customerId'): string | null {
  for (const snapshot of [row.after, row.before]) {
    if (snapshot && typeof snapshot === 'object' && field in snapshot) {
      const owner = (snapshot as Record<string, unknown>)[field];
      if (typeof owner === 'number' || typeof owner === 'string') return String(owner);
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
  const canViewDrivers = useCan('drivers.view');
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
        ? owningId(row, 'orderId')
        : null;
  // A customer return is over several orders: it leads to its customer, whose page lists them (Q161).
  const customerId =
    row.entityType === 'CUSTOMER' ? id : row.entityType === 'CUSTOMER_RETURN' ? owningId(row, 'customerId') : null;
  const target =
    row.entityType === 'ITEM' && canViewItems ? (
      <Link to="/items/$itemId" params={{ itemId: id }} className={LINK}>
        {text}
      </Link>
    ) : customerId && canViewCustomers ? (
      <Link to="/customers/$customerId" params={{ customerId }} className={LINK}>
        {text}
      </Link>
    ) : row.entityType === 'DRIVER' && canViewDrivers ? (
      <Link to="/drivers/$driverId" params={{ driverId: id }} className={LINK}>
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
    <ActorName user={row.user} />
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
