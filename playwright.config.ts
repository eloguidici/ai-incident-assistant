import { defineConfig, devices } from '@playwright/test';

const apiEnv = {
  ...process.env,
  DATABASE_URL: 'postgres://app:app@localhost:5432/incident_assistant_test',
  JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  LLM_PROVIDER: 'mock',
  PII_ENABLED: 'false', // Real detector runs in the dedicated PII/Compose battery.
  SOURCE_TEXT_MAX: '8000', // Synthetic regression profile, not the recommended CPU envelope.
  QUESTION_MAX: '1000',
  SEED_DEMO: 'true',
  ALLOW_SEED_DEMO: 'true',
  SEED_PASSWORD: 'Demo1234$',
  COOKIE_SECURE: 'false',
  E2E_RESET: 'true',
  FAULT_INJECTION: 'false',
  LLM_DEADLINE_MS: '2500',
  LLM_ATTEMPT_TIMEOUT_MS: '800',
  RATE_LIMIT_ANALYSES_PER_HOUR: '500',
  RATE_LIMIT_QUESTIONS_PER_HOUR: '500',
  PORT: '3001',
};

export default defineConfig({
  testDir: './qa/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  outputDir: 'qa-artifacts/playwright',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'qa-artifacts/playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://127.0.0.1:3001/api/health',
      timeout: 120_000,
      reuseExistingServer: false,
      env: apiEnv,
    },
    {
      command: 'npm run dev -w @app/web',
      env: { ...process.env, VITE_API_PROXY: 'http://127.0.0.1:3001' },
      url: 'http://127.0.0.1:5173',
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'e2e',
      use: { ...devices['Desktop Chrome'], video: 'retain-on-failure' },
      testIgnore: [/flows\//, /pii\//, /(demo|compose-stack)\.spec\.ts/],
    },
    {
      name: 'flows',
      use: { ...devices['Desktop Chrome'], video: 'retain-on-failure' },
      testMatch: /flows\/.*\.spec\.ts/,
      grepInvert: /@limits/,
    },
    { name: 'demo', use: { ...devices['Desktop Chrome'], video: 'on' }, testMatch: /demo\.spec\.ts/ },
  ],
});
