import { defineConfig, devices } from '@playwright/test';

// Runs against the full stack (API, web, Postgres, Redis, LocalStack, Mailpit), e.g. `docker compose up`.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  // One at a time: every test shares one database (e.g. staff tests act on the newest requests).
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3000',
    // PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome (e.g. where Playwright's Chromium isn't available).
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /customer-flow/ },
  ],
});
