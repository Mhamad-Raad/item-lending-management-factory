import type { GrantablePermissionKey, PermissionKey } from '../permissions.js';
import type {
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
