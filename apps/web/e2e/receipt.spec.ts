import { expect, test } from './fixtures';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};

/** A seven-line order, as the API chunks it: six lines on sheet 1, one on sheet 2 with the total. */
const lines = Array.from({ length: 7 }, (_, index) => ({
  itemName: `Pallet ${index + 1}`,
  quantity: 10,
  unitDeposit: 1_000,
  lineTotal: 10_000,
}));
const RECEIPT = {
  orderId: 9,
  orderNumber: 42,
  orderNumberDisplay: '000042',
  date: '2026-09-11',
  paymentType: 'LENT',
  depositTotal: 70_000,
  factory: { name: 'Pallet Factory', phone: '07500000000', address: 'Erbil', logoUrl: null },
  customer: { name: 'Kurdistan Cement', phone: '07501234567', altPhone: null, address: 'Erbil' },
  driver: { name: 'Karwan Aziz', phone: '07701112233', carNumber: 'Erbil 12 A 34567' },
  linesPerHalf: 6,
  sheets: [
    { sheetNumber: 1, sheetCount: 2, lines: lines.slice(0, 6), showTotal: false },
    { sheetNumber: 2, sheetCount: 2, lines: lines.slice(6), showTotal: true },
  ],
};

test('E5: a seven-line receipt prints on exactly two A4 sheets, in Sorani, and prints itself once', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      json: {
        accessToken: 'token',
        accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        user: ADMIN,
      },
    }),
  );
  await page.route(/\/api\/orders\/9\/receipt$/, (route) => route.fulfill({ json: RECEIPT }));

  await page.goto('/print/orders/9');
  await expect(page.locator('.sheet')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  const receipt = page.locator('.receipt');
  await expect(receipt).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.sheet').first()).toContainText('پەڕەی 1 لە 2');
  await expect(page.locator('.sheet').first()).not.toContainText('کۆی گشتی تەئمینات');
  await expect(page.locator('.sheet').last()).toContainText('کۆی گشتی تەئمینات');
  await expect(page.locator('.sheet').first()).toContainText('11/09/2026');
  await expect(page.locator('.half')).toHaveCount(4);

  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
  expect(pages).toHaveLength(2);
});
