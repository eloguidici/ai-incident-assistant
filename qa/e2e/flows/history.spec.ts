import { expect, test } from '@playwright/test';
import {
  ANALYST_A,
  ANALYST_B,
  INC_OK,
  createManyAnalysesViaApi,
  login,
  readCsrfToken,
  uniqueIncident,
  analyzeFromNew,
} from './helpers';

test.describe.configure({ mode: 'default' });

test('HIS-01 empty history for analyst B shows create-first link', async ({ page }) => {
  await login(page, ANALYST_B);
  await expect(page.getByTestId('empty-history')).toBeVisible();
  await page.getByRole('link', { name: 'Create the first one' }).click();
  await expect(page).toHaveURL(/\/new$/);
});

test.describe('history with analyst A', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ANALYST_A);
  });

  test('HIS-02 history item shows summary excerpt status and meta', async ({ page }) => {
    const text = uniqueIncident(INC_OK);
    await analyzeFromNew(page, text);
    const detailUrl = page.url();
    await page.getByRole('link', { name: 'Back to history' }).click();
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
    const item = page.getByRole('link').filter({ hasText: 'payments service' }).first();
    await expect(item).toContainText('completed');
    await item.click();
    await expect(page).toHaveURL(detailUrl);
    await expect(page.getByTestId('source-text')).toContainText('payments service');
  });

  test('HIS-03 clicking a history item opens the same analysis detail', async ({ page }) => {
    const text = uniqueIncident(INC_OK);
    await analyzeFromNew(page, text);
    await page.getByRole('link', { name: 'Back to history' }).click();
    await page.getByRole('link').filter({ hasText: 'payments service' }).first().click();
    await expect(page.getByTestId('source-text')).toContainText('payments service');
    await expect(page).toHaveURL(/\/history\/[0-9a-f-]+$/);
  });

  test('HIS-06 failed item shows failed status and Retry on detail', async ({ page }) => {
    const text = uniqueIncident(`${INC_OK} [MOCK:500]`);
    await page.goto('/new');
    await page.getByTestId('source-input').fill(text);
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByTestId('form-error')).toBeVisible();
    await page.getByRole('link', { name: 'History', exact: true }).click();
    await page.getByRole('link').filter({ hasText: 'failed' }).first().click();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('HIS-07 unknown or malformed analysis id shows not found alert', async ({ page }) => {
    await page.goto('/history/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('alert')).toContainText('That analysis was not found.');
    await page.goto('/history/not-a-uuid');
    await expect(page.getByRole('alert')).toContainText('That analysis was not found.');
  });

  test('HIS-08 back link returns to history list', async ({ page }) => {
    await analyzeFromNew(page, uniqueIncident(INC_OK));
    await page.getByRole('link', { name: 'Back to history' }).click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  });
});

test('HIS-05 pagination shows twenty items per page @limits-pagination', async ({ page }) => {
  test.setTimeout(600_000);
  await login(page, ANALYST_A);
  const csrf = await readCsrfToken(page);
  await createManyAnalysesViaApi(page.request, csrf, 21, 'pagination');
  await page.goto('/history');
  await expect(page.getByTestId('history-page-meta')).toContainText('Showing 1–20 of 21');
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('history-page-meta')).toContainText('Showing 21–21 of 21');
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
});
