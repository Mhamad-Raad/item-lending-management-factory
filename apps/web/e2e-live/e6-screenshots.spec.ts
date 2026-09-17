import { expect, test, type Page } from '@playwright/test';
import type { CustomerDto, DriverDto, ItemDto, OrderListItemDto, PageDto } from '@pallet/shared';
import { adminApi, figure, shown, signIn, sorani, stage, today, LIVE_ADMIN } from './live';

/**
 * E6 (§14.6): the three daily forms, filled in and ready to submit, in Sorani right to left, at a desktop and a
 * phone size. The baselines are rendered on the CI runner (Linux, `-linux.png`); fonts render differently elsewhere,
 * so other platforms skip. Everything on screen comes from records this test stages under fixed names, found again
 * rather than duplicated on a retry; only today's date is masked.
 */
test.describe('E6: the daily forms, right to left', () => {
  test.skip(
    process.platform !== 'linux' && !process.env.PALLET_E6_ANY_PLATFORM,
    'baselines are rendered on the Linux CI runner',
  );

  const VIEWPORTS = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'phone', width: 390, height: 844 },
  ] as const;

  for (const viewport of VIEWPORTS) {
    test(`E6: new order, return and payment forms at ${viewport.name} size`, async ({ page, request }) => {
      const api = await adminApi(request);
      const staged = stage(api);
      const once = async <T extends { name: string }>(path: string, name: string, create: () => Promise<T>) =>
        (await api.get<PageDto<T>>(`${path}?q=${encodeURIComponent(name)}`)).items.find((row) => row.name === name) ??
        (await create());
      const customer = await once<CustomerDto>('/api/customers', 'کۆمپانیای وێنەی نموونە', () =>
        staged.customer('کۆمپانیای وێنەی نموونە'),
      );
      const driver = await once<DriverDto>('/api/drivers', 'شۆفێری وێنەی نموونە', () =>
        staged.driver('شۆفێری وێنەی نموونە'),
      );
      const item = await once<ItemDto>('/api/items', 'پالێتی وێنەی نموونە', () =>
        staged.item('پالێتی وێنەی نموونە', 2_000, 500),
      );
      const existing = await api.get<PageDto<OrderListItemDto>>(`/api/orders?status=ALL&customerId=${customer.id}`);
      let orderId = existing.items[0]?.id;
      if (orderId === undefined) {
        const order = await staged.order({
          customerId: customer.id,
          driverId: driver.id,
          paymentType: 'LENT',
          lines: [{ itemId: item.id, quantity: 40 }],
        });
        await staged.payment(order.id, 50_000);
        orderId = order.id;
      }

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await signIn(page, LIVE_ADMIN.username, LIVE_ADMIN.password);
      // The viewport from the top, as the clerk first sees the filled form; a full-page capture would stitch the
      // sticky top bar and summary into the middle of the image. Today's date and the order's number vary per run.
      const shot = async (name: string) => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page).toHaveScreenshot(`${name}-${viewport.name}.png`, {
          mask: [
            page.getByRole('textbox', { name: sorani('returns.fields.date') }),
            page.getByText(shown(today()), { exact: true }),
            page.getByText(/^#\d{6}$/),
          ],
        });
      };

      // Daily flow 1: 12 pallets lent, 24,000 of deposit.
      await page.goto(`/orders/new?customerId=${customer.id}`);
      await expect(page.getByRole('combobox', { name: sorani('orders.fields.customer') })).toContainText(customer.name);
      await page.getByRole('combobox', { name: sorani('orders.fields.driver') }).click();
      await page.keyboard.type(driver.name);
      await page.getByRole('option', { name: new RegExp(driver.name) }).click();
      await page.getByRole('radio', { name: sorani('orders.new.lent') }).click();
      await page.locator('#lines-0-item').click();
      await page.keyboard.type(item.name);
      await page.getByRole('option', { name: new RegExp(item.name) }).click();
      await page.locator('#lines-0-quantity').fill('12');
      await expect(page.getByText(`${figure(24_000)} ${sorani('common.currency')}`).first()).toBeAttached();
      await blur(page);
      await shot('e2-new-order');

      // Daily flow 2: 30 of the 40 back against 30,000 owed — 30,000 to hand over.
      await page.goto(`/returns/new?orderId=${orderId}`);
      const accepted = page
        .getByRole('group', { name: new RegExp(item.name) })
        .getByLabel(sorani('returns.fields.accepted'), { exact: true });
      await accepted.fill('30');
      await expect(accepted).toHaveValue('30');
      await blur(page);
      await shot('e3-return');

      // Daily flow 3: 5,000 paid of 30,000 owed.
      await page.goto(`/payments/new?orderId=${orderId}`);
      const amount = page.getByLabel(sorani('payments.fields.amount'), { exact: true });
      await amount.fill('5000');
      await expect(amount).toHaveValue(figure(5_000));
      await blur(page);
      await shot('e4-payment');
    });
  }
});

/** Nothing focused: a focus ring or an open picker is not part of the form's baseline. */
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.getByRole('listbox')).toHaveCount(0);
}
