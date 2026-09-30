import { defineConfig, devices } from '@playwright/test';

/**
 * Browser checks against an already-running Docker Compose stack (nginx on :8080).
 * Does not start Vite or the API dev servers; run `docker compose up --build -d` first.
 */
export default defineConfig({
  testDir: './qa/e2e',
  testMatch: /compose-stack\.spec\.ts/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  outputDir: 'qa-artifacts/playwright-compose',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'qa-artifacts/playwright-compose-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'compose', use: { ...devices['Desktop Chrome'] } }],
});
