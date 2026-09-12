import type {
  AuditLogDto,
  CustomerDetailDto,
  DriverDto,
  ItemDto,
  LedgerEntryDto,
  MeDto,
  OrderDetailDto,
  OrderListItemDto,
  PageDto,
  PurchaseBatchDto,
  SettingsDto,
  StockMovementDto,
  UserDto,
} from '@pallet/shared';
import type { Page } from './fixtures';

/**
 * A believable API for pages that only need to render: one record of every kind, with the long
 * names and large amounts that stretch a layout. Typed with the shared DTOs, so a contract change
 * breaks the mock at compile time instead of leaving it quietly stale.
 */

const AT = '2026-09-11T08:00:00.000Z';
const BY = { id: 1, username: 'admin', displayName: 'Hawre Abdulrahman Mohammed' };

export const ADMIN: MeDto = {
  id: 1,
  username: 'admin',
  displayName: 'Hawre Abdulrahman Mohammed',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};

export const ITEM: ItemDto = {
  id: 5,
  name: 'Euro pallet 1200 × 800, heat treated, four-way entry',
  imageUploadId: null,
  imageUrl: null,
  depositPrice: 12_500_000,
  quantityOnHand: 125_000,
  minStock: 1_000,
  isLowStock: false,
  quantityOut: 48_250,
  damagedTotal: 1_320,
  archivedAt: null,
  version: 1,
  createdAt: AT,
  updatedAt: AT,
};

const ITEM_REF = { id: ITEM.id, name: ITEM.name, imageUrl: null, archived: false };

export const CUSTOMER: CustomerDetailDto = {
  id: 3,
  name: 'Kurdistan Cement and Construction Materials Trading Company',
  phone: '+9647501234567',
  altPhone: '+9647701234567',
  address: 'Industrial Area, 100 Metre Road, near the Erbil International Fair grounds, Erbil',
  creditLimit: 999_000_000,
  archivedAt: null,
  version: 1,
  createdAt: AT,
  updatedAt: AT,
  summary: {
    palletsOut: 48_250,
    outValue: 603_125_000,
    owed: 603_125_000,
    held: 120_000_000,
    compensation: 4_500_000,
    creditLimit: 999_000_000,
    headroom: 395_875_000,
    openOrderCount: 12,
  },
  holdings: [
    {
      item: ITEM_REF,
      quantityOut: 48_250,
      outValue: 603_125_000,
      sources: [
        { orderId: 9, orderNumber: 123_456, orderDate: '2026-09-11', quantityOut: 48_250, unitDeposit: 12_500 },
      ],
    },
  ],
  palletsOutByItem: [{ itemId: ITEM.id, itemName: ITEM.name, quantityOut: 48_250 }],
};

export const DRIVER: DriverDto = {
  id: 4,
  name: 'Karwan Aziz Hamad Ameen',
  phone: '+9647701112233',
  carNumber: 'Erbil 12 A 34567',
  archivedAt: null,
  version: 1,
  createdAt: AT,
  updatedAt: AT,
};

const ORDER_ROW: OrderListItemDto = {
  id: 9,
  orderNumber: 123_456,
  date: '2026-09-11',
  paymentType: 'LENT',
  status: 'OPEN',
  customer: { id: CUSTOMER.id, name: CUSTOMER.name, phone: CUSTOMER.phone, archived: false },
  driver: { id: DRIVER.id, name: DRIVER.name, phone: DRIVER.phone, carNumber: DRIVER.carNumber, archived: false },
  depositTotal: 603_125_000,
  owed: 603_125_000,
  outValue: 603_125_000,
  held: 0,
  outQuantityTotal: 48_250,
  createdAt: AT,
};

const LEDGER_ENTRY: LedgerEntryDto = {
  id: 11,
  orderId: ORDER_ROW.id,
  orderNumber: ORDER_ROW.orderNumber,
  customer: ORDER_ROW.customer,
  type: 'PAYMENT',
  source: 'MANUAL',
  amount: 120_000_000,
  date: '2026-09-11',
  effectiveDate: '2026-09-11',
  isAutomatic: false,
  returnId: null,
  reversesEntryId: null,
  reversedByEntryId: null,
  isReversed: false,
  canReverse: true,
  note: 'Paid in cash at the factory gate by the company accountant',
  createdAt: AT,
  createdBy: BY,
};

export const ORDER: OrderDetailDto = {
  ...ORDER_ROW,
  notes: 'Deliver to the second gate; the site manager signs for the pallets on arrival.',
  paymentsNet: 0,
  creditsTotal: 0,
  refundsNet: 0,
  compensation: 0,
  cancelledAt: null,
  cancelledBy: null,
  creditOverride: null,
  lines: [
    {
      id: 21,
      item: ITEM_REF,
      quantity: 48_250,
      unitDeposit: 12_500,
      lineTotal: 603_125_000,
      returnedAccepted: 0,
      returnedDamaged: 0,
      outQuantity: 48_250,
    },
  ],
  returns: [],
  ledgerEntries: [LEDGER_ENTRY],
  canEditLines: true,
  canCancel: true,
  version: 1,
  updatedAt: AT,
  createdBy: BY,
};

const EMPLOYEE: UserDto = {
  id: 2,
  username: 'shilan.employee',
  displayName: 'Shilan Omer Rasul',
  role: 'EMPLOYEE',
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: AT,
  version: 1,
  permissions: ['orders.view', 'orders.create', 'customers.view'],
  activeSessionCount: 2,
  createdAt: AT,
  updatedAt: AT,
};

const MOVEMENT: StockMovementDto = {
  id: 31,
  itemId: ITEM.id,
  quantity: -48_250,
  reason: 'ORDER_CREATE',
  batchId: null,
  orderId: ORDER.id,
  orderNumber: ORDER.orderNumber,
  returnId: null,
  note: null,
  balanceAfter: 125_000,
  createdAt: AT,
  createdBy: BY,
};

const BATCH: PurchaseBatchDto = {
  id: 41,
  itemId: ITEM.id,
  itemName: ITEM.name,
  date: '2026-09-01',
  quantity: 173_250,
  unitCost: 9_750,
  totalCost: 1_689_187_500,
  note: 'Delivered by the Sulaymaniyah sawmill in three trucks',
  version: 1,
  createdAt: AT,
  updatedAt: AT,
  createdBy: BY,
};

const AUDIT_ROW: AuditLogDto = {
  id: 51,
  createdAt: AT,
  user: BY,
  usernameAttempt: null,
  action: 'CREATE',
  entityType: 'ITEM',
  entityId: String(ITEM.id),
  summaryKey: 'audit.summary.ITEM.CREATE',
  summaryParams: { name: ITEM.name, depositPrice: ITEM.depositPrice, initialQuantity: 173_250 },
  ip: '192.168.100.200',
  requestId: null,
  before: null,
  after: null,
};

const SETTINGS: SettingsDto = {
  factoryName: 'Hawler Pallet Manufacturing Factory',
  phone: '+9647501234567',
  address: 'Industrial Area, 100 Metre Road, Erbil',
  logoUploadId: null,
  logoUrl: null,
  version: 1,
  updatedAt: AT,
};

const page1 = <T>(items: T[]): PageDto<T> => ({ items, page: 1, pageSize: 25, total: items.length * 40 });

/** Signs `user` in and answers every read the built pages make; writes are not needed here. */
export async function mockApi(
  page: Page,
  user: MeDto = ADMIN,
  language = 'ckb',
  theme: 'light' | 'dark' = 'light',
): Promise<void> {
  await page.addInitScript(
    ([lang, colours]) => {
      window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: lang, theme: colours }));
    },
    [language, theme] as const,
  );
  const routes: [RegExp, unknown][] = [
    [
      /\/api\/auth\/refresh$/,
      { accessToken: 'token', accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), user },
    ],
    [/\/api\/auth\/me$/, user],
    [/\/api\/orders(\?.*)?$/, page1([ORDER_ROW])],
    [/\/api\/orders\/\d+$/, ORDER],
    [/\/api\/customers(\?.*)?$/, page1([CUSTOMER])],
    [/\/api\/customers\/\d+$/, CUSTOMER],
    [/\/api\/drivers(\?.*)?$/, page1([DRIVER])],
    [/\/api\/drivers\/\d+$/, DRIVER],
    [/\/api\/items(\?.*)?$/, page1([ITEM])],
    [/\/api\/items\/\d+$/, ITEM],
    [/\/api\/items\/\d+\/stock-movements(\?.*)?$/, page1([MOVEMENT])],
    [/\/api\/purchase-batches(\?.*)?$/, page1([BATCH])],
    [/\/api\/ledger-entries(\?.*)?$/, page1([LEDGER_ENTRY])],
    [/\/api\/users(\?.*)?$/, page1([EMPLOYEE])],
    [/\/api\/users\/\d+$/, EMPLOYEE],
    [/\/api\/audit-logs(\?.*)?$/, page1([AUDIT_ROW])],
    [/\/api\/settings$/, SETTINGS],
  ];
  for (const [pattern, json] of routes) {
    await page.route(pattern, (route) => route.fulfill({ json }));
  }
}
