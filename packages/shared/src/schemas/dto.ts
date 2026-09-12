import type { GrantablePermissionKey, PermissionKey } from '../permissions.js';
import type { AuditAction, AuditEntityType, Role, StockMovementReason, UploadKind } from '../enums.js';

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
