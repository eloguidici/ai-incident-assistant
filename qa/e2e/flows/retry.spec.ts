import { expect, test } from '@playwright/test';
import { ANALYST_A, INC_OK, login, uniqueIncident } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page, ANALYST_A);
});

async function openFailedAnalysis(page: import('@playwright/test').Page, tag: string): Promise<void> {
  const text = uniqueIncident(`${INC_OK} ${tag}`);
  await page.goto('/new');
  await page.getByTestId('source-input').fill(text);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('form-error')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.getByRole('link').filter({ hasText: 'failed' }).first().click();
  await expect(page.getByRole('heading', { name: 'Analysis failed' })).toBeVisible();
}

test('RET-01 retry after double provider failure completes the analysis', async ({ page }) => {
  await openFailedAnalysis(page, '[MOCK:500-twice]');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Analysis completed' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('analysis-result')).toBeVisible();
  await expect(page.getByTestId('question-input')).toBeVisible();
});

test('RET-02 retry on permanent provider failure keeps failed state', async ({ page }) => {
  await openFailedAnalysis(page, '[MOCK:500]');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('action-error')).toContainText('The provider did not return a usable result.');
  await expect(page.getByRole('heading', { name: 'Analysis failed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('RET-03 Retry button is disabled while retry is pending', async ({ page }) => {
  await openFailedAnalysis(page, '[MOCK:timeout]');
  const retry = page.getByRole('button', { name: 'Retry' });
  await retry.click();
  await expect(retry).toBeDisabled();
  await expect(retry).toBeEnabled({ timeout: 30_000 });
});
