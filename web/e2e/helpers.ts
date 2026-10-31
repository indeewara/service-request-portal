import { expect, type Page } from '@playwright/test';

export const API_URL = process.env.API_URL ?? 'http://localhost:4000';
export const PASSWORD = 'Password123!';

export async function logIn(page: Page, email: string, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A real (tiny) PNG: the API checks the file's first bytes. */
export const tinyPng = () => ({
  name: 'damage.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
});

async function apiAs(email: string, path: string, method: string, body: unknown) {
  const login = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  return fetch(`${API_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

/** Staff action straight through the API, as if from another browser. */
export async function staffSetStatus(requestId: string, status: string) {
  const res = await apiAs('staff@example.com', `/requests/${requestId}/status`, 'PATCH', { status });
  expect(res.status).toBe(200);
}

export async function createRequestAs(email: string): Promise<string> {
  const res = await apiAs(email, '/requests', 'POST', {
    category: 'OTHER',
    orderNumber: `SO-E2E-${Date.now()}`,
    description: 'Created by an end-to-end test.',
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}
