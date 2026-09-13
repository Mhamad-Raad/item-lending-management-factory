/**
 * Enums shared by the API and the web app. Values are identical to the PostgreSQL enums in
 * apps/api/prisma/schema.prisma (a unit test asserts the match).
 */
const enumOf = <const T extends readonly string[]>(values: T) =>
  Object.freeze(Object.fromEntries(values.map((v) => [v, v]))) as { readonly [K in T[number]]: K };

export const ROLES = ['ADMIN', 'EMPLOYEE'] as const;
export const Role = enumOf(ROLES);
export type Role = (typeof ROLES)[number];

export const PAYMENT_TYPES = ['CASH', 'LENT'] as const;
export const PaymentType = enumOf(PAYMENT_TYPES);
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const ORDER_STATUSES = ['OPEN', 'SETTLED', 'CANCELLED'] as const;
export const OrderStatus = enumOf(ORDER_STATUSES);
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STOCK_MOVEMENT_REASONS = [
  'BATCH_ADD',
  'BATCH_EDIT',
  'BATCH_DELETE',
  'ORDER_CREATE',
  'ORDER_LINE_EDIT',
  'ORDER_CANCEL',
  'RETURN_ACCEPTED',
  'RETURN_EDIT',
  'RETURN_DELETE',
  'MANUAL_ADJUSTMENT',
] as const;
export const StockMovementReason = enumOf(STOCK_MOVEMENT_REASONS);
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

export const LEDGER_ENTRY_TYPES = ['PAYMENT', 'REFUND', 'PAYMENT_REVERSAL', 'REFUND_REVERSAL'] as const;
export const LedgerEntryType = enumOf(LEDGER_ENTRY_TYPES);
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const LEDGER_ENTRY_SOURCES = [
  'ORDER_CREATE',
  'ORDER_LINE_EDIT',
  'ORDER_CANCEL',
  'MANUAL',
  'PAYMENT_DELETE',
  'RETURN_CREATE',
  'RETURN_EDIT',
  'RETURN_DELETE',
] as const;
export const LedgerEntrySource = enumOf(LEDGER_ENTRY_SOURCES);
export type LedgerEntrySource = (typeof LEDGER_ENTRY_SOURCES)[number];

export const RETURN_REVERSAL_KINDS = ['EDIT', 'DELETE'] as const;
export const ReturnReversalKind = enumOf(RETURN_REVERSAL_KINDS);
export type ReturnReversalKind = (typeof RETURN_REVERSAL_KINDS)[number];

export const UPLOAD_KINDS = ['ITEM_IMAGE', 'FACTORY_LOGO'] as const;
export const UploadKind = enumOf(UPLOAD_KINDS);
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'CANCEL',
  'STOCK_ADJUST',
  'PAYMENT_CREATE',
  'PAYMENT_REVERSE',
  'RETURN_CREATE',
  'RETURN_EDIT',
  'RETURN_DELETE',
  'REFUND_CREATE',
  'REFUND_REVERSE',
  'CREDIT_OVERRIDE',
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOCKOUT',
  'LOGOUT',
  'LOGOUT_ALL',
  'SESSION_REUSE_DETECTED',
  'PASSWORD_CHANGE',
  'PASSWORD_RESET',
  'PERMISSION_CHANGE',
  'SETTINGS_CHANGE',
  'USER_DEACTIVATE',
  'USER_ACTIVATE',
  'UPLOAD_CREATE',
] as const;
export const AuditAction = enumOf(AUDIT_ACTIONS);
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  'USER',
  'SESSION',
  'ITEM',
  'PURCHASE_BATCH',
  'CUSTOMER',
  'DRIVER',
  'ORDER',
  'RETURN',
  'LEDGER_ENTRY',
  'SETTINGS',
  'UPLOAD',
] as const;
export const AuditEntityType = enumOf(AUDIT_ENTITY_TYPES);
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** The dashboard's recent activity events (§6.9 `ActivityEventDto`); a reversal is flagged, not a kind. */
export const ACTIVITY_EVENT_KINDS = ['HANDOVER', 'CANCELLATION', 'RETURN', 'PAYMENT', 'REFUND'] as const;
export type ActivityEventKind = (typeof ACTIVITY_EVENT_KINDS)[number];

/** The entries of a customer's history timeline (§6.9 `CustomerHistoryItemDto`), and its `kinds` filter. */
export const CUSTOMER_HISTORY_KINDS = ['HANDOVER', 'RETURN', 'LEDGER'] as const;
export type CustomerHistoryKind = (typeof CUSTOMER_HISTORY_KINDS)[number];

// Browser preferences (localStorage only)
export const LANGUAGES = ['ckb', 'ar', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const RTL_LANGUAGES: readonly Language[] = ['ckb', 'ar'];

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const FONT_SIZES = ['sm', 'md', 'lg', 'xl'] as const;
export type FontSize = (typeof FONT_SIZES)[number];
/** Root font size in px per step; every UI size is rem-based and derives from it. */
export const FONT_SIZE_PX: Readonly<Record<FontSize, number>> = { sm: 14, md: 16, lg: 18, xl: 20 };
