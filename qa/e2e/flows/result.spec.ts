import { expect, test } from '@playwright/test';
import { ANALYST_A, INC_OK, INC_SHORT, login, uniqueIncident, analyzeFromNew } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page, ANALYST_A);
});

test('RES-01 completed analysis shows summary evidence hypotheses missing and uncertainty', async ({ page }) => {
  await analyzeFromNew(page, uniqueIncident(INC_OK));
  await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible();
  await expect(page.getByText(/Category:.*Suggested severity:/)).toBeVisible();
  await expect(page.getByTestId('evidence')).toBeVisible();
  await expect(page.getByTestId('hypotheses')).toBeVisible();
  await expect(page.getByTestId('hypotheses')).toContainText(/Confidence (low|medium|high)\./);
  await expect(page.getByTestId('missing')).toBeVisible();
  await expect(page.getByTestId('uncertainty')).toBeVisible();
});

test('RES-02 evidence quotes are substrings of the submitted source text', async ({ page }) => {
  const text = uniqueIncident(INC_OK);
  await analyzeFromNew(page, text);
  const source = await page.getByTestId('source-text').innerText();
  const quotes = await page.getByTestId('evidence').locator('blockquote').allTextContents();
  for (const quote of quotes) {
    expect(source).toContain(quote);
  }
});

test('RES-03 short incident keeps uncertainty and grounded-quote messaging', async ({ page }) => {
  await analyzeFromNew(page, uniqueIncident(INC_SHORT));
  await expect(page.getByTestId('uncertainty')).not.toBeEmpty();
  const quoteCount = await page.getByTestId('evidence').locator('blockquote').count();
  if (quoteCount === 0) {
    await expect(page.getByTestId('evidence')).toContainText('There are no quotes grounded in the text.');
    await expect(page.getByTestId('missing').locator('li')).not.toHaveCount(0);
  }
});

test('RES-04 model metadata shows prompt version and mock model', async ({ page }) => {
  await analyzeFromNew(page, uniqueIncident(INC_OK));
  const meta = await page.getByTestId('model-meta').innerText();
  expect(meta).toContain('Prompt incident-analysis.v');
  expect(meta).toContain('Model mock-incident-v1');
  expect(meta).toContain('Kept until ');
});

test('RES-05 reload keeps source text and result', async ({ page }) => {
  const text = uniqueIncident(INC_OK);
  await analyzeFromNew(page, text);
  const sourceBefore = await page.getByTestId('source-text').innerText();
  const summarySnippet = 'The text describes an observed failure. The cause is not confirmed.';
  await page.reload();
  await expect(page.getByTestId('source-text')).toHaveText(sourceBefore);
  await expect(page.getByTestId('analysis-result')).toContainText(summarySnippet);
});
