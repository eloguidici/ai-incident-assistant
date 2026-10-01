import { defineConfig, devices } from '@playwright/test';

const apiPort = process.env.FLOWS_LIMITS_API_PORT ?? '3101';
const webPort = process.env.FLOWS_LIMITS_WEB_PORT ?? '5273';
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;

type LimitsSuite = 'session' | 'analyses-2' | 'questions-2' | 'context' | 'pagination';

const suite = (process.env.FLOWS_LIMITS_SUITE ?? 'session') as LimitsSuite;

const suiteConfig: Record<
  LimitsSuite,
  { grep: RegExp; apiOverrides: Record<string, string> }
> = {
  session: {
    grep: /@limits-session/,
    apiOverrides: {
      JWT_TTL_SECONDS: '60',
      LOGIN_MAX_ATTEMPTS: '3',
      RATE_LIMIT_ANALYSES_PER_HOUR: '50',
      RATE_LIMIT_QUESTIONS_PER_HOUR: '40',
    },
  },
  'analyses-2': {
    grep: /@limits-analyses-2/,
    apiOverrides: {
      RATE_LIMIT_ANALYSES_PER_HOUR: '2',
      RATE_LIMIT_QUESTIONS_PER_HOUR: '40',
    },
  },
  'questions-2': {
    grep: /@limits-questions-2/,
    apiOverrides: {
      RATE_LIMIT_ANALYSES_PER_HOUR: '50',
      RATE_LIMIT_QUESTIONS_PER_HOUR: '2',
    },
  },
  context: {
    grep: /@limits-context/,
    apiOverrides: {
      CONTEXT_CHAR_BUDGET: '250',
      RATE_LIMIT_ANALYSES_PER_HOUR: '50',
      RATE_LIMIT_QUESTIONS_PER_HOUR: '40',
    },
  },
  pagination: {
    grep: /@limits-pagination/,
    apiOverrides: {
      RATE_LIMIT_ANALYSES_PER_HOUR: '50',
      RATE_LIMIT_QUESTIONS_PER_HOUR: '40',
    },
  },
};

const active = suiteConfig[suite] ?? suiteConfig.session;

function apiEnv(overrides: Record<string, string>): Record<string, string> {
  return {
    ...process.env,
    DATABASE_URL: 'postgres://app:app@localhost:5432/incident_assistant_test',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
    WEB_ORIGIN: webBase,
    LLM_PROVIDER: 'mock',
    SEED_DEMO: 'true',
    ALLOW_SEED_DEMO: 'true',
    SEED_PASSWORD: 'local-demo-password',
    COOKIE_SECURE: 'false',
    E2E_RESET: 'true',
    FAULT_INJECTION: 'false',
    LLM_DEADLINE_MS: '2500',
    LLM_ATTEMPT_TIMEOUT_MS: '800',
    PORT: apiPort,
    ...overrides,
  };
}

export default defineConfig({
  testDir: './qa/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  grep: active.grep,
  outputDir: `qa-artifacts/playwright-flows-limits-${suite}`,
  reporter: [['list'], ['html', { open: 'never', outputFolder: `qa-artifacts/playwright-flows-limits-${suite}-report` }]],
  use: {
    baseURL: webBase,
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: `${apiBase}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: apiEnv(active.apiOverrides),
    },
    {
      command: `npm run dev -w @app/web -- --host 127.0.0.1 --port ${webPort}`,
      env: { ...process.env, VITE_API_PROXY: apiBase },
      url: webBase,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
  projects: [{ name: `limits-${suite}`, use: { ...devices['Desktop Chrome'], video: 'retain-on-failure' } }],
});
