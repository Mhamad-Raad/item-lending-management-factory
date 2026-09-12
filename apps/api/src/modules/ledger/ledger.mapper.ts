import { dbDateToBusiness, type AuditAction, type LedgerEntryDto, type LedgerEntryType } from '@pallet/shared';
import { toSafeMoney } from '../../common/utils/money';
import type { Customer, LedgerEntry, Prisma } from '../../generated/prisma/client';
import { toAuditSnapshot } from '../audit/audit-snapshot';
import type { AuditEntry } from '../audit/audit.service';
import { toCustomerRef } from '../customers/customers.mapper';
import { USER_REF_SELECT, toUserRef } from '../users/users.mapper';

/** What a ledger row needs besides its own columns: who recorded it, and the row that reversed it. */
export const LEDGER_ENTRY_INCLUDE = {
  createdBy: USER_REF_SELECT,
  reversedBy: { select: { id: true } },
} as const satisfies Prisma.LedgerEntryInclude;

export type LedgerEntryRow = Prisma.LedgerEntryGetPayload<{ include: typeof LEDGER_ENTRY_INCLUDE }>;

/** The order a ledger row belongs to, as far as the row's DTO names it. */
export interface LedgerOrderContext {
  id: number;
  orderNumber: number;
  date: Date;
  customer: Customer;
}

export function toLedgerEntryDto(entry: LedgerEntryRow, order: LedgerOrderContext): LedgerEntryDto {
  const isReversed = entry.reversedBy !== null;
  return {
    id: entry.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    customer: toCustomerRef(order.customer),
    type: entry.type,
    source: entry.source,
    amount: toSafeMoney(entry.amount),
    date: entry.date ? dbDateToBusiness(entry.date) : null,
    // The automatic hand-over payment has no date of its own: it happened on the order's (§4.7.2).
    effectiveDate: dbDateToBusiness(entry.date ?? order.date),
    isAutomatic: entry.isAutomatic,
    returnId: entry.returnId,
    reversesEntryId: entry.reversesEntryId,
    reversedByEntryId: entry.reversedBy?.id ?? null,
    isReversed,
    canReverse: entry.type === 'PAYMENT' && entry.source === 'MANUAL' && !isReversed,
    note: entry.note,
    createdAt: entry.createdAt.toISOString(),
    createdBy: toUserRef(entry.createdBy),
  };
}

const AUDIT_ACTIONS: Record<LedgerEntryType, AuditAction> = {
  PAYMENT: 'PAYMENT_CREATE',
  PAYMENT_REVERSAL: 'PAYMENT_REVERSE',
  REFUND: 'REFUND_CREATE',
  REFUND_REVERSAL: 'REFUND_REVERSE',
};

/** The history row of a ledger entry (§11.3); only a payment says whether it was automatic. */
export function ledgerAuditEntry(entry: LedgerEntry, orderNumber: number): AuditEntry {
  const amount = toSafeMoney(entry.amount);
  return {
    action: AUDIT_ACTIONS[entry.type],
    entityType: 'LEDGER_ENTRY',
    entityId: String(entry.id),
    summaryParams:
      entry.type === 'PAYMENT' ? { orderNumber, amount, automatic: entry.isAutomatic } : { orderNumber, amount },
    after: toAuditSnapshot('LEDGER_ENTRY', entry),
  };
}
