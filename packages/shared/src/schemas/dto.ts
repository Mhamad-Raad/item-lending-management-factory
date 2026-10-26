import type { GrantablePermissionKey, PermissionKey } from '../permissions.js';
import type {
  ActivityEventKind,
  AuditAction,
  AuditEntityType,
  LedgerEntrySource,
  LedgerEntryType,
  OrderStatus,
  PalletCreditReason,
  PaymentType,
  ReturnReversalKind,
  Role,
  StockMovementReason,
  UploadKind,
} from '../enums.js';
import type { ReceiptLayout } from '../domain/ledger-math.js';

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

/** `GET /api/health` (§6.25): the database answered and the uploads volume has room (Q61). */
export interface HealthDto {
  status: 'ok';
  db: 'ok';
  disk: 'ok';
  version: string;
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
/**
 * The money fields are order data: they are omitted (not null) for a caller without `orders.view`,
 * as cost fields are without `items.viewCost` (Q72).
 */
export interface CustomerSummaryDto {
  palletsOut: number;
  outValue?: number;
  owed?: number;
  held?: number;
  compensation?: number;
  creditLimit: number | null;
  /** `creditLimit − outValue`, negative after an admin override; null when there is no limit. */
  headroom?: number | null;
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
  /** Omitted without `orders.view` (Q72). */
  outValue?: number;
  /** The orders the pallets went out on, oldest first; `unitDeposit` omitted without `orders.view` (Q72). */
  sources: { orderId: number; orderNumber: number; orderDate: string; quantityOut: number; unitDeposit?: number }[];
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
    }
  | {
      /** What the factory owes the customer of a pallet type moved (Q170): owed, given back, used by an order. */
      kind: 'PALLET';
      date: string;
      createdAt: string;
      palletCreditId: number;
      reason: PalletCreditReason;
      item: ItemRefDto;
      /** + owed to them, − given back or used. */
      quantity: number;
      orderId: number | null;
      orderNumber: number | null;
      note: string | null;
      /** A give-back undone since (Q173); false on every other entry. */
      undone: boolean;
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

/** Another driver holding a phone number (§6.18, Q135). */
export interface DriverPhoneMatchDto {
  driverId: number;
  name: string;
  carNumber: string;
  archived: boolean;
}

export interface DriverPhoneCheckDto {
  normalizedPhone: string;
  matches: DriverPhoneMatchDto[];
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
  /** The customer return over several orders it was recorded in, whose one paper is its receipt (Q161, Q166). */
  customerReturnId: number | null;
}

/** A return written, replaced or deleted (§6.20): the return's id and the order as it now stands. */
export interface ReturnResultDto {
  returnId: number;
  order: OrderDetailDto;
}

/** One of a customer's open orders with pallets still out, as the return flow offers it (§6.20, Q156). */
export interface ReturnableOrderDto {
  id: number;
  orderNumber: number;
  date: string;
  paymentType: PaymentType;
  owed: number;
  outQuantityTotal: number;
  /** Only the lines with pallets still out, by line id. */
  lines: OrderLineDto[];
}

/** Everything a customer still holds, order by order, oldest first (Q156). */
export interface CustomerReturnableDto {
  customer: CustomerRefDto;
  orders: ReturnableOrderDto[];
}

/** One row of the returns list (Q168). */
export interface ReturnListItemDto {
  id: number;
  date: string;
  orderId: number;
  orderNumber: number;
  customer: CustomerRefDto;
  accepted: number;
  damaged: number;
  refundDue: number;
  cashRefund: number;
  reversed: boolean;
  /** Its standing refund, whose receipt it prints (Q137); null when it paid no cash back. */
  refundEntryId: number | null;
  /** The customer return over several orders it was recorded in (Q161). */
  customerReturnId: number | null;
  createdAt: string;
  createdBy: UserRefDto;
}

/**
 * A return to edit from the returns list (Q174): everything the customer holds as if it — and, for a return over
 * several orders, the rest of that visit — had never been recorded, and what it took back, to start the form from.
 */
export interface CustomerReturnEditableDto extends CustomerReturnableDto {
  returnId: number;
  customerReturnId: number | null;
  date: string;
  notes: string | null;
  /** The cash it paid back, standing: an edit hands over or takes back only the difference. */
  cashRefunded: number;
  /** What it took back of each item over all its orders, its extra pallets in the accepted count. */
  items: { itemId: number; accepted: number; damaged: number; damagedRefund: number }[];
  /** Its extra pallets still owed, by item, in `items`' accepted counts: sent back with the save (Q174). */
  reopened: { itemId: number; quantity: number }[];
  /** The same by order line, as it was placed, so an unchanged count stays on the orders it was on. */
  lines: { orderLineId: number; accepted: number; damaged: number; damagedRefund: number }[];
}

/** A return the customer flow recorded on one order (Q156), with what it paid out. */
export interface CustomerReturnRecordedDto {
  returnId: number;
  orderId: number;
  orderNumber: number;
  accepted: number;
  damaged: number;
  refundDue: number;
  owedBefore: number;
  cashRefund: number;
  owedAfter: number;
  /** The REFUND row the return paid out, for its receipt (Q137); null when it paid nothing. */
  refundEntryId: number | null;
}

/** What `POST /customers/:customerId/returns` recorded: a return per order, by order number (Q156). */
export interface CustomerReturnResultDto {
  /**
   * The visit the returns belong to when they are over two orders or more, whose receipt is one paper for all of them;
   * null for a return on one order, which is that order's own (Q161).
   */
  customerReturnId: number | null;
  customer: CustomerRefDto;
  returns: CustomerReturnRecordedDto[];
  /** Pallets beyond what was out, owed to the customer from now on (Q170). */
  surplus: { item: ItemRefDto; quantity: number }[];
}

/**
 * The paper of pallets the factory owed, given back (Q172): one type, how many, and what was owed before and after,
 * as it stood then — a reprint says what the original said.
 */
export interface HandBackReceiptDto {
  palletCreditId: number;
  /** Its place among the give-backs, zero-padded to six digits: a numbering of their own, without gaps (Q172). */
  receiptNumberDisplay: string;
  date: string;
  printedOn: string;
  itemName: string;
  quantity: number;
  owedBefore: number;
  owedAfter: number;
  note: string | null;
  recordedBy: UserRefDto;
  /** The day it was undone (Q173), stamped on the paper; null while it stands. */
  reversedOn: string | null;
  factory: ReceiptFactoryDto;
  customer: { name: string; phone: string; address: string };
}

/** A give-back recorded (Q170): its entry, for its paper (Q172). */
export interface HandBackResultDto {
  palletCreditId: number;
}

/** What the factory owes a customer of one pallet type (Q170): what came back beyond what was out, less what was given back. */
export interface PalletCreditBalanceDto {
  item: ItemRefDto;
  quantity: number;
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
  /** A refund's customer return, whose receipt covers every order it touched (Q161); null on every other row. */
  customerReturnId: number | null;
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
  /** Pallets the factory owed the customer that went out with this order, no deposit (Q170); none once cancelled. */
  fromCredit: { item: ItemRefDto; quantity: number }[];
  /** Not cancelled, and no non-reversed return or manual payment yet. */
  canEditLines: boolean;
  canCancel: boolean;
  version: number;
  updatedAt: string;
  createdBy: UserRefDto;
}

/** The factory as every printed receipt heads it, from Settings (§7.16.3, Q137). */
export interface ReceiptFactoryDto {
  name: string;
  phone: string;
  address: string;
  logoUrl: string | null;
}

export interface ReceiptLineDto {
  itemName: string;
  quantity: number;
  unitDeposit: number;
  lineTotal: number;
  /** Of this order's line alone, as recorded when the receipt was asked for (Q134); reversed returns do not count. */
  returnedAccepted: number;
  returnedDamaged: number;
  /** `quantity − returnedAccepted − returnedDamaged`: what the customer still holds. */
  outQuantity: number;
}

/**
 * What the customer still holds of one item at one deposit price, over all their earlier orders (Q150, Q158), printed
 * under this order's lines. Only what is still out: the business does not want the quantities, returns and damage
 * of those orders on this receipt. Its total column is `outValue`, the deposit of what the customer still holds.
 */
export interface ReceiptOlderLineDto {
  itemName: string;
  unitDeposit: number;
  /** Summed over the earlier orders' lines of this item at this price. */
  outQuantity: number;
  /** `outQuantity × unitDeposit`. */
  outValue: number;
}

/**
 * A row of the hand-over receipt's table (Q150): one of this order's lines, the heading over the earlier orders'
 * lines, or one of those. `no` is the row's number on the paper, running on from this order's lines.
 */
export type ReceiptRowDto =
  | ({ kind: 'line'; no: number } & ReceiptLineDto)
  /** Pallets the factory owed the customer, handed over with this order and no deposit (Q170). */
  | { kind: 'fromCredit'; no: number; itemName: string; quantity: number }
  | { kind: 'olderHeading' }
  | ({ kind: 'older'; no: number } & ReceiptOlderLineDto);

export interface ReceiptSheetDto {
  /** 1-based. */
  sheetNumber: number;
  sheetCount: number;
  /** At most `rowsPerCopy`. */
  rows: ReceiptRowDto[];
  /** True only on the last sheet. */
  showTotal: boolean;
}

export interface ReceiptDto {
  orderId: number;
  orderNumber: number;
  /** Zero-padded to six digits. */
  orderNumberDisplay: string;
  date: string;
  /** The business day the receipt was asked for: what its returned figures are true as of (Q134). */
  printedOn: string;
  paymentType: PaymentType;
  depositTotal: number;
  factory: ReceiptFactoryDto;
  customer: { name: string; phone: string; altPhone: string | null; address: string };
  driver: { name: string; phone: string; carNumber: string };
  /**
   * `layoutReceiptRows` (Q150): `halves` prints each chunk's two copies on one A4 sheet, `pages` gives each copy an
   * A4 page of its own.
   */
  layout: ReceiptLayout;
  /** The rows a copy's table has room for: `RECEIPT_LINES_PER_HALF` or `RECEIPT_ROWS_PER_PAGE`. */
  rowsPerCopy: number;
  /** One per chunk of rows; each chunk is printed twice, the factory's copy and the customer's. */
  sheets: ReceiptSheetDto[];
  /**
   * What the customer still holds of earlier orders (Q150, Q158): its deposit, and that added to `depositTotal`. Null
   * when there are none, and the footer prints the order's total alone.
   */
  older: { outValue: number; combinedTotal: number } | null;
}

/** One pallet type a return's receipt lists (Q167): what came back of it, at its deposit, and what that credited. */
export interface ReturnReceiptLineDto {
  itemName: string;
  accepted: number;
  damaged: number;
  unitDeposit: number;
  /** What it credited: `accepted × unitDeposit + damagedRefund`. */
  total: number;
  /** How many of this pallet type the customer still holds over all their orders, as the paper is printed (Q169). */
  withCustomer: number;
  /** Of this return's pallets, how many came back beyond what was out, owed to the customer (Q170). */
  extra: number;
}

/**
 * The receipt of one sum of money (Q137): a payment the factory received, or a refund it paid out on a return.
 * Its balance is the order's when the money moved, not today's, so a reprint says what the original said.
 */
export interface MoneyReceiptDto {
  ledgerEntryId: number;
  /** The ledger row's id, zero-padded to six digits: the receipt's number. */
  receiptNumberDisplay: string;
  kind: 'PAYMENT' | 'REFUND';
  /** A payment's date (the order's for the automatic one); a refund's is its return's. */
  date: string;
  /** The business day the receipt was asked for. */
  printedOn: string;
  amount: number;
  /**
   * What the order owed just before: this payment, or the return that paid this refund. Null only for a payment
   * recorded before the figure was kept whose replay cannot be trusted: its receipt prints the amount alone.
   */
  owedBefore: number | null;
  /** A refund's alone: what the returned pallets were credited (the return's `refundDue`). */
  credit: number | null;
  /** What the order owed straight after; 0 after a refund; null with `owedBefore`. */
  owedAfter: number | null;
  /** Where the money came from: the hand-over (`ORDER_CREATE`), a line edit's re-issue, by hand, or a return. */
  source: LedgerEntrySource;
  note: string | null;
  recordedBy: UserRefDto;
  /** The business day the row was reversed (a deleted payment, an edited or deleted return); null while it stands. */
  reversedOn: string | null;
  order: { id: number; orderNumber: number; orderNumberDisplay: string; date: string };
  factory: ReceiptFactoryDto;
  customer: { name: string; phone: string; address: string };
  /** A refund's: the pallets its return took back (Q167); none on a payment. */
  lines: ReturnReceiptLineDto[];
}

/**
 * The receipt of a customer's return over several orders (Q161): one paper for the visit, in the money receipt's
 * design, without an order. Its figures are the sums of its orders' returns as they were recorded; a later
 * correction of one of them leaves them as they were and stamps the paper. It prints whether cash went back or not
 * (Q166).
 */
export interface CustomerReturnReceiptDto {
  customerReturnId: number;
  /** The customer return's id, zero-padded to six digits: a numbering of its own (Q161). */
  receiptNumberDisplay: string;
  date: string;
  printedOn: string;
  /** Σ what each order owed just before its return. */
  owedBefore: number;
  /** Σ what the returned pallets were credited (each return's `refundDue`). */
  credit: number;
  /** Σ the cash paid back. */
  amount: number;
  /** Σ what each order still owed after its return. */
  owedAfter: number;
  note: string | null;
  recordedBy: UserRefDto;
  /** The latest day one of its returns was corrected or deleted; null while all stand. */
  reversedOn: string | null;
  /** Every one of its returns was corrected or deleted (the stamp says reversed, not partly). */
  allReversed: boolean;
  factory: ReceiptFactoryDto;
  customer: { name: string; phone: string; address: string };
  /** The pallets its returns took back, by type and deposit (Q167). */
  lines: ReturnReceiptLineDto[];
}

/**
 * The receipt of one return that paid no cash back (Q166): the customer return's paper for that return alone, with
 * its order, numbered by the return. Its figures are the return's as recorded; corrected or deleted since, it is
 * stamped.
 */
export interface ReturnReceiptDto extends Omit<CustomerReturnReceiptDto, 'customerReturnId' | 'allReversed'> {
  returnId: number;
  order: { id: number; orderNumber: number; orderNumberDisplay: string; date: string };
}

/** One payment or refund on an order's transactions receipt (Q139). */
export interface TransactionsReceiptRowDto {
  ledgerEntryId: number;
  /** Its own money receipt's number (Q137). */
  receiptNumberDisplay: string;
  kind: 'PAYMENT' | 'REFUND';
  /** The day the money moved, as on its own receipt. */
  date: string;
  amount: number;
  /** The business day it was reversed; null while it stands. A reversed row is listed but counts in no total. */
  reversedOn: string | null;
}

export interface TransactionsReceiptSheetDto {
  /** 1-based. */
  sheetNumber: number;
  sheetCount: number;
  /** At most `RECEIPT_LINES_PER_HALF`. */
  rows: TransactionsReceiptRowDto[];
  /** True only on the last sheet. */
  showTotal: boolean;
}

/**
 * Every payment and refund of one order on one paper (Q139), by date, with the totals of those that stand and what
 * the order owes on the day it is printed.
 */
export interface TransactionsReceiptDto {
  order: { id: number; orderNumber: number; orderNumberDisplay: string; date: string };
  /** The business day the receipt was asked for: what its totals are true as of. */
  printedOn: string;
  factory: ReceiptFactoryDto;
  customer: { name: string; phone: string; address: string };
  /** Of the rows that stand. */
  received: number;
  refunded: number;
  /** What the order owes now. */
  owed: number;
  rowsPerHalf: number;
  /** One per `chunkReceiptLines` chunk; each A4 sheet prints its chunk twice. */
  sheets: TransactionsReceiptSheetDto[];
}

// ── dashboard (§6.9, §6.22) ──

export interface ActivityEventDto {
  kind: ActivityEventKind;
  /** When it was recorded: `createdAt`, or `cancelledAt` for a cancellation. */
  at: string;
  /** Its business date. */
  date: string;
  /** Null for a CUSTOMER_RETURN, which is over several orders (Q161). */
  orderId: number | null;
  orderNumber: number | null;
  /** CUSTOMER_RETURN: its id and how many orders it touched; otherwise null. */
  customerReturnId: number | null;
  orderCount: number | null;
  customer: CustomerRefDto;
  /** HANDOVER: Σ line quantity; RETURN, CUSTOMER_RETURN: accepted + damaged (a visit's as recorded); otherwise null. */
  quantity: number | null;
  /**
   * HANDOVER: deposit total; RETURN: refund due; CUSTOMER_RETURN: the cash handed back, its receipt's headline (its
   * refunds are not events of their own, Q161); PAYMENT / REFUND: amount; CANCELLATION: null. The page shows the
   * quantity instead of a 0.
   */
  amount: number | null;
  /** RETURN: the return is reversed; CUSTOMER_RETURN: all its returns are; PAYMENT / REFUND: the row is. */
  reversed: boolean;
  /** CUSTOMER_RETURN: some of its returns are reversed, not all (Q161); otherwise false. */
  partlyReversed: boolean;
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
    /** The items this customer has out, in column order; an item missing here has 0 out (Q103). */
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
  /** More than 5,000 customers matched: `rows` holds the first 5,000 in the sort order; totals are complete (§12.1). */
  truncated: boolean;
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

/** A record named in a report row: its id and its name, nothing else (Q99). */
export interface NamedRefDto {
  id: number;
  name: string;
}

/** One page of a report section, and how many rows the whole section holds (Q99). */
export interface ReportSectionDto<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** A payment, refund or reversal in the activity report, on its effective date. */
export interface ActivityMoneyRowDto {
  id: number;
  orderId: number;
  orderNumber: number;
  /** The effective date: the row's own, or its order's for the automatic payment. */
  date: string;
  customer: NamedRefDto;
  type: LedgerEntryType;
  amount: number;
  /** Set on a reversal: the row it reverses. */
  reversesEntryId: number | null;
}

/**
 * Report 3 (Q99): each section is one page of its rows, in the section's order (date, then time of
 * recording); `totals` always cover every row of the period.
 */
export interface ActivityReportDto {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  filters: { customerId: number | null; itemId: number | null; driverId: number | null };
  /** True when `itemId` is set: money is recorded per order, not per item. */
  moneyOmitted: boolean;
  handovers: ReportSectionDto<{
    orderId: number;
    orderNumber: number;
    date: string;
    customer: NamedRefDto;
    driver: NamedRefDto;
    paymentType: PaymentType;
    /** With an item filter, that item's line only. */
    lines: { item: NamedRefDto; quantity: number }[];
    quantity: number;
    depositTotal: number;
  }>;
  returns: ReportSectionDto<{
    returnId: number;
    orderId: number;
    orderNumber: number;
    date: string;
    customer: NamedRefDto;
    acceptedQuantity: number;
    damagedQuantity: number;
    /** Over the lines counted: with an item filter, the credit that item's lines gave. */
    refundDue: number;
    /** 0 with an item filter: cash is paid per return, not per item. */
    cashRefund: number;
  }>;
  /** PAYMENT and PAYMENT_REVERSAL rows, reversals as their own rows; empty when money is omitted. */
  payments: ReportSectionDto<ActivityMoneyRowDto>;
  /** REFUND and REFUND_REVERSAL rows; empty when money is omitted. */
  refunds: ReportSectionDto<ActivityMoneyRowDto>;
  /** One row per damaged return line. */
  compensation: ReportSectionDto<{
    returnLineId: number;
    returnId: number;
    orderNumber: number;
    date: string;
    customer: NamedRefDto;
    item: NamedRefDto;
    damagedQuantity: number;
    damagedRefund: number;
    compensation: number;
  }>;
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
  /** More than 5,000 items matched: `rows` holds the first 5,000 in the sort order; totals are complete (§12.1). */
  truncated: boolean;
}
