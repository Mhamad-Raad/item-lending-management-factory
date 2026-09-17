import { expect, test } from '@playwright/test';
import { adminApi, signIn, sorani, stage, LIVE_ADMIN, RUN } from './live';

/** E8 (§14.6): a control the user may not use is not shown — the API refuses it anyway (S-12). */
test('E8: an employee without orders.cancel sees no Cancel button, where the admin does', async ({ page, request }) => {
  const api = await adminApi(request);
  const staged = stage(api);
  const [customer, driver, item] = await Promise.all([
    staged.customer(`کارگەی بلۆکی ڕێبین ${RUN}`),
    staged.driver(`دانا عومەر ${RUN}`),
    staged.item(`پالێتی تاقیکردنەوە E8-${RUN}`, 1_500, 30),
  ]);
  const order = await staged.order({
    customerId: customer.id,
    driverId: driver.id,
    paymentType: 'LENT',
    lines: [{ itemId: item.id, quantity: 5 }],
  });
  const cancel = sorani('orders.detail.cancelOrder');

  await signIn(page, LIVE_ADMIN.username, LIVE_ADMIN.password);
  await page.goto(`/orders/${order.id}`);
  await expect(page.getByRole('button', { name: cancel })).toBeVisible();

  // A viewer: may read orders (with what they show), may not cancel. The first password is changed through the API.
  const first = 'Kurdistan-Pallets-2026!';
  const chosen = 'Viewer-Only-Gate-2026!';
  const username = `e8viewer${Date.now().toString(36)}`;
  await api.createEmployee(username, first, ['orders.view']);
  const login = await request.post('/api/auth/login', {
    headers: { 'X-Requested-With': 'pallet-web' },
    data: { username, password: first },
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const changed = await request.post('/api/auth/change-password', {
    headers: { Authorization: `Bearer ${accessToken}`, 'X-Requested-With': 'pallet-web' },
    data: { currentPassword: first, newPassword: chosen },
  });
  expect(changed.ok()).toBe(true);

  await page.context().clearCookies();
  await signIn(page, username, chosen);
  await page.goto(`/orders/${order.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: cancel })).toHaveCount(0);
});
