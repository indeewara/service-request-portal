import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { logIn } from './helpers';

// WCAG 2.1 A and AA rules, on every page and on the error and dialog states.
async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`);
  console.log(`axe ${label}: ${results.passes.length} rules passed, ${results.violations.length} violations`);
  expect(summary, label).toEqual([]);
}

test('public pages', async ({ page }) => {
  await page.goto('/login');
  await expectNoViolations(page, '/login');
  await page.goto('/help');
  await expectNoViolations(page, '/help');
});

test('customer pages', async ({ page }) => {
  await logIn(page, 'alice@example.com', '/requests/new');
  await expect(page).toHaveURL(/\/requests\/new$/);
  await expectNoViolations(page, '/requests/new');

  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.locator('.error-summary')).toBeVisible();
  await expectNoViolations(page, '/requests/new (with errors)');

  await page.goto('/requests');
  await expectNoViolations(page, '/requests');
  await page.locator('.cards a').first().click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await expectNoViolations(page, '/requests/[id]');
});

test('staff pages', async ({ page }) => {
  await logIn(page, 'staff@example.com', '/staff');
  await expect(page).toHaveURL(/\/staff$/);
  await expectNoViolations(page, '/staff');

  await page.goto('/staff?status=NEW');
  await expect(page.getByRole('columnheader', { name: 'Customer' })).toBeVisible();
  await page.getByRole('table').getByRole('link').first().click();
  await expect(page).toHaveURL(/\/staff\/requests\//);
  // Staff see who raised the request and how to contact them.
  await expect(page.getByRole('link', { name: /@example\.com$/ })).toHaveAttribute('href', /^mailto:/);
  await expectNoViolations(page, '/staff/requests/[id]');

  await page.getByRole('button', { name: 'Change status…' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoViolations(page, '/staff/requests/[id] (confirm dialog)');
});

test('keyboard only: staff filter and confirm a status change', async ({ page }) => {
  await logIn(page, 'staff@example.com', '/staff?status=NEW');
  await page.getByRole('table').getByRole('link').first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/staff\/requests\//);

  await page.getByRole('button', { name: 'Change status…' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Yes, change status' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Change status…' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // confirm
  await expect(page.getByRole('status').filter({ hasText: 'Status changed to In review' })).toBeVisible();
});
