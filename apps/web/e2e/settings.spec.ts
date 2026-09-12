import { expect, test, type Page } from '@playwright/test';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};

const SETTINGS = {
  factoryName: 'Pallet Factory',
  phone: '-',
  address: '-',
  logoUploadId: null,
  logoUrl: null,
  version: 1,
  updatedAt: '2026-09-12T08:00:00.000Z',
};

const LOGO = {
  id: 7,
  kind: 'FACTORY_LOGO',
  url: `/api/uploads/${'a'.repeat(32)}.webp`,
  width: 120,
  height: 40,
};

/** A 1×1 PNG: real image bytes, so the browser declares `image/png` and can show a preview. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function signInAsAdmin(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
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
}

test('an admin changes the factory name and uploads a logo', async ({ page }) => {
  await signInAsAdmin(page);
  let uploads = 0;
  let saved: Record<string, unknown> | undefined;

  await page.route(/\/api\/uploads\?kind=FACTORY_LOGO$/, (route) => {
    uploads += 1;
    return route.fulfill({ status: 201, json: LOGO });
  });
  await page.route(/\/api\/uploads\/[0-9a-f]{32}\.webp$/, (route) =>
    route.fulfill({ contentType: 'image/png', body: PNG }),
  );
  await page.route(/\/api\/settings$/, (route) => {
    if (route.request().method() !== 'PUT') return route.fulfill({ json: SETTINGS });
    saved = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { ...SETTINGS, ...saved, logoUrl: LOGO.url, version: 2 } });
  });

  await page.goto('/settings');
  const name = page.getByLabel('Factory name');
  await expect(name).toHaveValue('Pallet Factory');

  await name.fill('Erbil Pallets');
  await page.locator('input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: 'Image preview' })).toBeVisible();

  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Settings saved')).toBeVisible();
  expect(uploads).toBe(1);
  // The whole form goes back with the version it was loaded at, and the logo as an upload id.
  expect(saved).toEqual({ version: 1, factoryName: 'Erbil Pallets', phone: '-', address: '-', logoUploadId: 7 });
});

test('an image over 5 MB is refused before anything is sent', async ({ page }) => {
  await signInAsAdmin(page);
  let uploads = 0;
  await page.route(/\/api\/uploads\?/, (route) => {
    uploads += 1;
    return route.fulfill({ status: 201, json: LOGO });
  });
  await page.route(/\/api\/settings$/, (route) => route.fulfill({ json: SETTINGS }));

  await page.goto('/settings');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(5_242_881) });

  await expect(page.getByRole('alert').filter({ hasText: 'The image is too large' })).toBeVisible();
  expect(uploads).toBe(0);
});

test('Save waits for a logo that is still uploading', async ({ page }) => {
  await signInAsAdmin(page);
  let finishUpload!: () => void;
  const uploadHeld = new Promise<void>((resolve) => (finishUpload = resolve));
  await page.route(/\/api\/uploads\?kind=FACTORY_LOGO$/, async (route) => {
    await uploadHeld;
    return route.fulfill({ status: 201, json: LOGO });
  });
  await page.route(/\/api\/uploads\/[0-9a-f]{32}\.webp$/, (route) =>
    route.fulfill({ contentType: 'image/png', body: PNG }),
  );
  await page.route(/\/api\/settings$/, (route) => route.fulfill({ json: SETTINGS }));

  await page.goto('/settings');
  await page.locator('input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });

  // Saving now would store the old logo, report success, and then lose the new one.
  const save = page.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();

  finishUpload();
  await expect(page.getByRole('img', { name: 'Image preview' })).toBeVisible();
  await expect(save).toBeEnabled();
});
