import { expect, test } from '@playwright/test';
import { createRequestAs, logIn, staffSetStatus, tinyPng } from './helpers';

test('customer reports a problem with a photo and sees the status change live', async ({ page }) => {
  // Logging in from a protected page returns there afterwards.
  await logIn(page, 'alice@example.com', '/requests/new');
  await expect(page).toHaveURL(/\/requests\/new$/);

  // The token lives only in an httpOnly, Secure, SameSite cookie: page scripts can't read it.
  const session = (await page.context().cookies()).find((c) => c.name === 'session');
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
  expect(await page.evaluate(() => document.cookie)).not.toContain('session');
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);

  const orderNumber = `SO-E2E-${Date.now()}`;
  await page.getByLabel('Category').selectOption({ label: 'Damaged delivery' });
  await page.getByLabel('Order number').fill(orderNumber);
  await page.getByLabel('Description').fill('Three pallets of tiles arrived cracked.\nPhotos attached.');
  await page.getByLabel('Photos (optional)').setInputFiles(tinyPng());
  await page.getByRole('button', { name: 'Send request' }).click();

  // Created, photo uploaded straight to S3, then on to the request page.
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Request for order ${orderNumber}`);
  await expect(page.getByRole('img', { name: /Photo 1 of 1/ })).toBeVisible();
  await expect(page.locator('.facts')).toContainText('New');
  await expect(page.getByText('Live updates on')).toBeVisible();

  // Staff move it on; the open page updates without a reload.
  await page.evaluate(() => ((window as unknown as { marker: boolean }).marker = true));
  const requestId = page.url().split('/').pop()!;
  await staffSetStatus(requestId, 'IN_REVIEW');

  await expect(page.getByRole('status').filter({ hasText: 'Status updated to In review' })).toBeVisible();
  await expect(page.locator('.facts')).toContainText('In review');
  await expect(page.locator('.history')).toContainText('In review');
  expect(await page.evaluate(() => (window as unknown as { marker?: boolean }).marker)).toBe(true);
});

test("a customer cannot open another customer's request", async ({ page }) => {
  const alicesRequest = await createRequestAs('alice@example.com');
  await logIn(page, 'bob@example.com', '/requests');
  await page.goto(`/requests/${alicesRequest}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await expect(page.getByText('Created by an end-to-end test.')).toHaveCount(0);
});

test('each role is kept to its own pages', async ({ browser }) => {
  for (const [email, otherRolesPage, home] of [
    ['alice@example.com', '/staff', /\/requests$/],
    ['staff@example.com', '/requests/new', /\/staff$/],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await logIn(page, email, otherRolesPage);
    await expect(page).toHaveURL(home);
    await context.close();
  }
});
