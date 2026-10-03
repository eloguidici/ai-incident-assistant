import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const servers = base.webServer as { command: string; url: string; env: Record<string, string> }[];

/** Isolated mock-provider regression ports; does not certify real detector/model quality. */
export default defineConfig({
  ...base,
  outputDir: 'qa-artifacts/t22-regression-browser',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'qa-artifacts/t22-regression-browser-report' }]],
  use: { ...base.use, baseURL: 'http://127.0.0.1:5183' },
  webServer: [
    { ...servers[0], url: 'http://127.0.0.1:3011/api/health',
      env: { ...servers[0].env, PORT: '3011', WEB_ORIGIN: 'http://127.0.0.1:5183' } },
    { ...servers[1], command: 'npm run dev -w @app/web -- --port 5183', url: 'http://127.0.0.1:5183',
      env: { ...servers[1].env, VITE_API_PROXY: 'http://127.0.0.1:3011' } },
  ],
});
