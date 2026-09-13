import type { GrantablePermissionKey, PermissionKey } from '../permissions.js';
import type {
  ActivityEventKind,
  AuditAction,
  AuditEntityType,
  LedgerEntrySource,
  LedgerEntryType,
  OrderStatus,
  PaymentType,
  ReturnReversalKind,
  Role,
  StockMovementReason,
  UploadKind,
} from '../enums.js';

export interface UserRefDto {
  id: number;
  username: string;
  displayName: string;
}

/** The signed-in user as they see themselves (`GET /api/auth/me`). */
export interface MeDto {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  /** Admin: every key; employee: the stored keys. Sorted ascending. */
  permissions: PermissionKey[];
}

export interface AuthTokenDto {
  accessToken: string;
  /** ISO-8601 UTC. */
  accessTokenExpiresAt: string;
  user: MeDto;
}

export interface UserListItemDto {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  version: number;
}

export interface UserDto extends UserListItemDto {
  /** Employee: the stored keys, sorted. Admin: empty — every key is implicit. */
  permissions: GrantablePermissionKey[];
  /** Families that are neither revoked nor past their absolute expiry. */
  activeSessionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogDto {
  id: number;
  createdAt: string;
  user: UserRefDto | null;
  usernameAttempt: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string | null;
  summaryKey: string;
  summaryParams: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
  before: unknown;
  after: unknown;
}

export interface SettingsDto {
  factoryName: string;
  phone: string;
  address: string;
  logoUploadId: number | null;
  /** `/api/uploads/<file>` of the logo, or null when there is none. */
  logoUrl: string | null;
  version: number;
  updatedAt: string;
}

export interface UploadDto {
  id: number;
  kind: UploadKind;
  url: string;
  width: number;
  height: number;
}

export interface ItemDto {
  id: number;
  name: string;
  imageUploadId: number | null;
  imageUrl: string | null;
  depositPrice: number;
  quantityOnHand: number;
  minStock: number | null;
  /** `minStock !== null && quantityOnHand <= minStock`. */
  isLowStock: boolean;
  /** Pallets out with customers, over orders that are not cancelled. */
  quantityOut: number;
  /** Pallets returned damaged, over live returns of orders that are not cancelled. */
  damagedTotal: number;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovementDto {
  id: number;
  itemId: number;
  quantity: number;
  reason: StockMovementReason;
  batchId: number | null;
  orderId: number | null;
  orderNumber: number | null;
  returnId: number | null;
  note: string | null;
  /** The item's stock right after this row: the running sum of its whole ledger. */
  balanceAfter: number;
  createdAt: string;
  createdBy: UserRefDto;
}

export interface StockAdjustmentResultDto {
  movement: StockMovementDto;
  item: ItemDto;
}

export interface PurchaseBatchDto {
  id: number;
  itemId: number;
  itemName: string;
  date: string;
  quantity: number;
  /** Omitted, not null, for a viewer without `items.viewCost`. */
  unitCost?: number;
  totalCost?: number;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: UserRefDto;
}

export interface ItemRefDto {
  id: number;
  name: string;
  imageUrl: string | null;
  archived: boolean;
}

/** A customer's sums over its orders that are not cancelled (§4.5); zeros until it has orders. */
export interface CustomerSummaryDto {
  palletsOut: number;
  outValue: number;
  owed: number;
  held: number;
  compensation: number;
  creditLimit: number | null;
  /** `creditLimit − outValue`, negative after an admin override; null when there is no limit. */
  headroom: number | null;
  openOrderCount: number;
}

export interface CustomerDto {
  id: number;
  name: string;
  phone: string;
  altPhone: string | null;
  address: string;
  creditLimit: number | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  summary: CustomerSummaryDto;
}

export interface CustomerHoldingDto {
  item: ItemRefDto;
  quantityOut: number;
  outValue: number;
  /** The orders the pallets went out on, oldest first. */
  sources: { orderId: number; orderNumber: number; orderDate: string; quantityOut: number; unitDeposit: number }[];
}

export interface CustomerDetailDto extends CustomerDto {
  /** Ordered by item name. */
  holdings: CustomerHoldingDto[];
  palletsOutByItem: { itemId: number; itemName: string; quantityOut: number }[];
}

export interface CustomerPhoneMatchDto {
  customerId: number;
  name: string;
  archived: boolean;
  matchedField: 'phone' | 'altPhone';
}

export interface CustomerPhoneCheckDto {
  normalizedPhone: string;
  matches: CustomerPhoneMatchDto[];
}

/** One entry of a customer's timeline (§6.9): a hand-over, a return, or a money ledger row. */
export type CustomerHistoryItemDto =
  | {
      kind: 'HANDOVER';
      date: string;
      createdAt: string;
      orderId: number;
      orderNumber: number;
      paymentType: PaymentType;
      status: OrderStatus;
      cancelled: boolean;
      driver: DriverRefDto;
      lines: { item: ItemRefDto; quantity: number; unitDeposit: number; lineTotal: number }[];
      quantityTotal: number;
      depositTotal: number;
    }
  | {
      kind: 'RETURN';
      date: string;
      createdAt: string;
      returnId: number;
      orderId: number;
      orderNumber: number;
      reversed: boolean;
      reversalKind: ReturnReversalKind | null;
      replacedByReturnId: number | null;
      lines: { item: ItemRefDto; acceptedQuantity: number; damagedQuantity: number; damagedRefund: number }[];
      acceptedTotal: number;
      damagedTotal: number;
      refundDue: number;
      cashRefund: number;
    }
  | {
      kind: 'LEDGER';
      /** The effective date: the row's own, or its order's for the automatic payment. */
      date: string;
      createdAt: string;
      ledgerEntryId: number;
      orderId: number;
      orderNumber: number;
      type: LedgerEntryType;
      source: LedgerEntrySource;
      amount: number;
      isAutomatic: boolean;
      reversesEntryId: number | null;
      note: string | null;
    };

export interface DriverDto {
  id: number;
  name: string;
  phone: string;
  carNumber: string;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerRefDto {
  id: number;
  name: string;
  phone: string;
  archived: boolean;
}

export interface DriverRefDto {
  id: number;
  name: string;
  phone: string;
  carNumber: string;
  archived: boolean;
}

export interface OrderListItemDto {
  id: number;
  orderNumber: number;
  date: string;
  paymentType: PaymentType;
  status: OrderStatus;
  customer: CustomerRefDto;
  driver: DriverRefDto;
  depositTotal: number;
  owed: number;
  outValue: number;
  held: number;
  outQuantityTotal: number;
  createdAt: string;
}

export interface OrderLineDto {
  id: number;
  item: ItemRefDto;
  quantity: number;
  unitDeposit: number;
  lineTotal: number;
  returnedAccepted: number;
  returnedDamaged: number;
  outQuantity: number;
}

export interface ReturnLineDto {
  id: number;
  orderLineId: number;
  item: ItemRefDto;
  acceptedQuantity: number;
  damagedQuantity: number;
  unitDeposit: number;
  damagedRefund: number;
  /** `damagedQuantity × unitDeposit − damagedRefund`. */
  compensation: number;
}

export interface ReturnDto {
  id: number;
  orderId: number;
  orderNumber: number;
  date: string;
  notes: string | null;
  refundDue: number;
  owedBefore: number;
  cashRefund: number;
  lines: ReturnLineDto[];
  reversed: boolean;
  reversedAt: string | null;
  reversedBy: UserRefDto | null;
  reversalKind: ReturnReversalKind | null;
  replacedByReturnId: number | null;
  replacesReturnId: number | null;
  /** `!reversed`, whatever the viewer's permissions. */
  canReverse: boolean;
  createdAt: string;
  createdBy: UserRefDto;
}

/** A return written, replaced or deleted (§6.20): the return's id and the order as it now stands. */
export interface ReturnResultDto {
  returnId: number;
  order: OrderDetailDto;
}

/** A payment recorded or reversed (§6.21): the ledger row written and the order as it now stands. */
export interface PaymentResultDto {
  ledgerEntryId: number;
  order: OrderDetailDto;
}

export interface LedgerEntryDto {
  id: number;
  orderId: number;
  orderNumber: number;
  customer: CustomerRefDto;
  type: LedgerEntryType;
  source: LedgerEntrySource;
  amount: number;
  /** The stored business date; null only for the automatic hand-over payment. */
  date: string | null;
  /** `date`, or the order's date for the automatic payment. */
  effectiveDate: string;
  isAutomatic: boolean;
  returnId: number | null;
  reversesEntryId: number | null;
  reversedByEntryId: number | null;
  isReversed: boolean;
  /** A manual payment that is not yet reversed, whatever the viewer's permissions. */
  canReverse: boolean;
  note: string | null;
  createdAt: string;
  createdBy: UserRefDto;
}

export interface OrderDetailDto extends OrderListItemDto {
  notes: string | null;
  paymentsNet: number;
  creditsTotal: number;
  refundsNet: number;
  compensation: number;
  cancelledAt: string | null;
  cancelledBy: UserRefDto | null;
  creditOverride: { by: UserRefDto; at: string } | null;
  /** By line id. */
  lines: OrderLineDto[];
  /** Every return, reversed ones included, by id. */
  returns: ReturnDto[];
  /** Every ledger row, reversals included, by id — the order they were recorded in. */
  ledgerEntries: LedgerEntryDto[];
  /** Not cancelled, and no non-reversed return or manual payment yet. */
  canEditLines: boolean;
  canCancel: boolean;
  version: number;
  updatedAt: string;
  createdBy: UserRefDto;
}

export interface ReceiptLineDto {
  itemName: string;
  quantity: number;
  unitDeposit: number;
  lineTotal: number;
}

export interface ReceiptSheetDto {
  /** 1-based. */
  sheetNumber: number;
  sheetCount: number;
  /** At most `RECEIPT_LINES_PER_HALF`. */
  lines: ReceiptLineDto[];
  /** True only on the last sheet. */
  showTotal: boolean;
}

export interface ReceiptDto {
  orderId: number;
  orderNumber: number;
  /** Zero-padded to six digits. */
  orderNumberDisplay: string;
  date: string;
  paymentType: PaymentType;
  depositTotal: number;
  factory: { name: string; phone: string; address: string; logoUrl: string | null };
  customer: { name: string; phone: string; altPhone: string | null; address: string };
  driver: { name: string; phone: string; carNumber: string };
  linesPerHalf: number;
  /** One per `chunkReceiptLines` chunk; each A4 sheet prints its chunk twice. */
  sheets: ReceiptSheetDto[];
}

// ── dashboard (§6.9, §6.22) ──

export interface ActivityEventDto {
  kind: ActivityEventKind;
  /** When it was recorded: `createdAt`, or `cancelledAt` for a cancellation. */
  at: string;
  /** Its business date. */
  date: string;
  orderId: number;
  orderNumber: number;
  customer: CustomerRefDto;
  /** HANDOVER: Σ line quantity; RETURN: accepted + damaged; otherwise null. */
  quantity: number | null;
  /** HANDOVER: deposit total; RETURN: refund due; PAYMENT / REFUND: amount; CANCELLATION: null. */
  amount: number | null;
  /** RETURN: the return is reversed; PAYMENT / REFUND: the row is reversed; otherwise false. */
  reversed: boolean;
}

/** Each section is present only for a viewer allowed to see it (§6.22, Q12). */
export interface DashboardDto {
  positions?: {
    palletsOut: number;
    outValue: number;
    owed: number;
    held: number;
    openOrderCount: number;
    customersWithOpenOrders: number;
  };
  lowStock?: {
    count: number;
    items: { id: number; name: string; imageUrl: string | null; quantityOnHand: number; minStock: number }[];
  };
  recentActivity?: ActivityEventDto[];
}

// ── reports (§6.9, §6.23, Q42) ──

export interface PositionsReportDto {
  generatedAt: string;
  /** Items with pallets out across the included rows, by name. */
  columns: ItemRefDto[];
  rows: {
    customer: CustomerRefDto;
    /** One entry per column, 0 allowed. */
    palletsOutByItem: { itemId: number; quantityOut: number }[];
    palletsOut: number;
    outValue: number;
    owed: number;
    held: number;
  }[];
  totals: {
    palletsOutByItem: { itemId: number; quantityOut: number }[];
    palletsOut: number;
    outValue: number;
    owed: number;
    held: number;
  };
}

/** Every money field is cost data: the endpoint refuses a viewer without `items.viewCost`. */
export interface PurchasesReportDto {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  /** Date, then id. */
  rows: {
    batchId: number;
    item: ItemRefDto;
    date: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
    note: string | null;
  }[];
  /** Item name. Never an average: batches are not averaged (§12.3). */
  perItem: { item: ItemRefDto; batchCount: number; quantity: number; totalCost: number }[];
  totals: { batchCount: number; quantity: number; totalCost: number };
  /** More than 5,000 rows matched; totals are still complete (§12.1). */
  truncated: boolean;
}

export interface ActivityReportDto {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  filters: { customerId: number | null; itemId: number | null; driverId: number | null };
  /** True when `itemId` is set: money is recorded per order, not per item. */
  moneyOmitted: boolean;
  handovers: {
    orderId: number;
    orderNumber: number;
    date: string;
    customer: CustomerRefDto;
    driver: DriverRefDto;
    paymentType: PaymentType;
    lines: { item: ItemRefDto; quantity: number; unitDeposit: number; lineTotal: number }[];
    quantity: number;
    depositTotal: number;
  }[];
  returns: {
    returnId: number;
    orderId: number;
    orderNumber: number;
    date: string;
    customer: CustomerRefDto;
    lines: {
      item: ItemRefDto;
      acceptedQuantity: number;
      damagedQuantity: number;
      damagedRefund: number;
      compensation: number;
    }[];
    acceptedQuantity: number;
    damagedQuantity: number;
    refundDue: number;
    cashRefund: number;
  }[];
  /** PAYMENT and PAYMENT_REVERSAL rows, reversals as their own rows; [] when money is omitted. */
  payments: LedgerEntryDto[];
  /** REFUND and REFUND_REVERSAL rows; [] when money is omitted. */
  refunds: LedgerEntryDto[];
  compensation: {
    returnId: number;
    orderNumber: number;
    date: string;
    customer: CustomerRefDto;
    item: ItemRefDto;
    damagedQuantity: number;
    unitDeposit: number;
    damagedRefund: number;
    compensation: number;
  }[];
  totals: {
    handoverQuantity: number;
    handoverDepositTotal: number;
    returnedAccepted: number;
    returnedDamaged: number;
    refundDueTotal: number;
    /** The money totals are 0 when money is omitted. */
    paymentsGross: number;
    paymentReversals: number;
    paymentsNet: number;
    refundsGross: number;
    refundReversals: number;
    refundsNet: number;
    compensationAssessed: number;
  };
  /** A section passed 5,000 rows; totals are still complete (§12.1). */
  truncated: boolean;
}

export interface StockReportDto {
  generatedAt: string;
  rows: {
    item: ItemRefDto;
    quantityOnHand: number;
    quantityOut: number;
    damagedTotal: number;
    minStock: number | null;
    isLowStock: boolean;
  }[];
  totals: { quantityOnHand: number; quantityOut: number; damagedTotal: number; lowStockCount: number };
}
