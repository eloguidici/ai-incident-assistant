import { defineConfig, devices } from '@playwright/test';

const runTag = process.env.PII_QA_RUN_ID?.replace(/[^A-Za-z0-9_-]/g, '-');
const artifactName = `playwright-pii-${process.env.PII_QA_MODE ?? 'full'}${runTag ? `-${runTag}` : ''}`;

/**
 * Collects only the opt-in PII battery against an existing Compose stack.
 * E2E_BASE_URL overrides the default http://localhost:8080 for an isolated stack.
 * The .pii.ts suffix keeps these files outside the general projects' .spec/.test discovery.
 * No servers, database resets, HTTP mocks, or retries are configured here.
 */
export default defineConfig({
  testDir: './qa/e2e/pii',
  testMatch: process.env.PII_QA_MODE && process.env.PII_QA_MODE !== 'full' ? '**/modes.pii.ts' : '**/*.pii.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: `qa-artifacts/${artifactName}`,
  reporter: [['list'], ['html', { open: 'never', outputFolder: `qa-artifacts/${artifactName}-report` }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    channel: 'chrome',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'pii-compose', use: { ...devices['Desktop Chrome'] } }],
});
