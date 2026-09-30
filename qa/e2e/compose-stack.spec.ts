import { expect, test } from '@playwright/test';

const incident =
  'On 2026-09-30 at 14:00 UTC the checkout API returned HTTP 503 for nine minutes. No deployment occurred in that window.';

async function login(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('local-demo-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'There are no analyses yet' }).or(page.getByRole('heading', { name: 'History' }))).toBeVisible();
}

test.describe('nginx compose stack', () => {
  test('serves React and proxies /api/health to NestJS', async ({ request, page }) => {
    const health = await request.get('/api/health');
    expect(health.ok()).toBeTruthy();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in to analyze an incident' })).toBeVisible();
  });

  test('walks login, analysis, follow-up, history, reload, logout', async ({ page }) => {
    await login(page, 'analyst.a@example.test');
    await page.getByRole('link', { name: 'New' }).click();
    await page.getByTestId('source-input').fill(incident);
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByText('Analyzing… this can take a few seconds.')).toBeVisible();
    await expect(page.getByTestId('analysis-result')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('uncertainty')).not.toBeEmpty();
    await page.getByTestId('question-input').fill('What evidence is still missing?');
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(page.getByTestId('assistant-answer')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('link', { name: 'Back to history' }).click();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('link').filter({ hasText: 'checkout API' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to analyze an incident' })).toBeVisible();
  });

  test('rejects invalid input and blocks cross-user access', async ({ browser, page }) => {
    await login(page, 'analyst.a@example.test');
    await page.getByRole('link', { name: 'New' }).click();
    await page.getByTestId('source-input').fill(`${incident} Private to analyst A.`);
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByTestId('analysis-result')).toBeVisible({ timeout: 30_000 });
    const url = page.url();
    await page.getByRole('button', { name: 'Sign out' }).click();
    const other = await browser.newPage();
    await login(other, 'analyst.b@example.test');
    await other.goto(url);
    await expect(other.getByRole('alert')).toContainText('not found');
    await other.close();
  });

  test('does not expose internal documentation through nginx', async ({ request }) => {
    const response = await request.get('/docs/requirements/ASSESSMENT.md');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).not.toContain('| R01 |');
    expect(body).not.toContain('Matriz de requisitos');
    expect(body).toMatch(/<div id="root"><\/div>/i);
  });
});
