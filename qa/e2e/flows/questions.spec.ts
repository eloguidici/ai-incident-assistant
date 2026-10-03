import { expect, test } from '@playwright/test';
import { ANALYST_A, INC_OK, INC_SHORT, analyzeFromNew, login, uniqueIncident } from './helpers';

const followUpQuestion = 'What information is missing to confirm the cause?';

test.beforeEach(async ({ page }) => {
  await login(page, ANALYST_A);
});

async function openCompletedAnalysis(page: import('@playwright/test').Page): Promise<void> {
  await analyzeFromNew(page, uniqueIncident(INC_OK));
}

test('ASK-02 two questions appear in Analyst Assistant order', async ({ page }) => {
  await openCompletedAnalysis(page);
  await page.getByTestId('question-input').fill(`${followUpQuestion} First`);
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByTestId('message-completed').filter({ hasText: 'Assistant' }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId('question-input').fill(`${followUpQuestion} Second`);
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByTestId('message-completed').filter({ hasText: 'Assistant' })).toHaveCount(2, {
    timeout: 30_000,
  });
  const order = await page.locator('.thread li .meta').allTextContents();
  expect(order.join('|')).toMatch(/Analyst.*Assistant.*Analyst.*Assistant/);
});

test('ASK-03 answer disclosure shows thread result detail sections', async ({ page }) => {
  await openCompletedAnalysis(page);
  await page.getByTestId('question-input').fill(followUpQuestion);
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByTestId('assistant-answer')).toBeVisible({ timeout: 30_000 });
  await page.getByText('Evidence, hypotheses, and uncertainty').click();
  await expect(page.getByTestId('thread-result-detail')).toBeVisible();
  await expect(page.getByTestId('thread-result-detail').getByTestId('evidence')).toBeVisible();
});

test('ASK-04 Ask stays disabled for empty or whitespace question', async ({ page }) => {
  await openCompletedAnalysis(page);
  await expect(page.getByRole('button', { name: 'Ask' })).toBeDisabled();
  await page.getByTestId('question-input').fill('   ');
  await expect(page.getByRole('button', { name: 'Ask' })).toBeDisabled();
});

test('ASK-05 long question shows length validation error', async ({ page }) => {
  await openCompletedAnalysis(page);
  const { questionMax } = await (await page.request.get('/api/analyses/limits')).json() as { questionMax: number };
  const longQuestion = 'q'.repeat(questionMax + 1);
  await page.getByTestId('question-input').fill(longQuestion);
  await expect(page.getByRole('button', { name: 'Ask' })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('The question exceeds the maximum length.');
  expect(await page.getByTestId('question-input').inputValue()).toBe(longQuestion);
  await expect(page.getByTestId('message-completed')).toHaveCount(0);
});

test('ASK-06 failed question keeps completed analysis and a clean retry works', async ({ page }) => {
  await openCompletedAnalysis(page);
  await page.getByTestId('question-input').fill('Why? [MOCK:invalid-json]');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByTestId('action-error')).toContainText(
    'The model response could not be validated. Model output is not JSON. No result was accepted.',
  );
  await expect(page.getByTestId('message-failed').last()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Analysis completed' })).toBeVisible();
  await expect(page.getByTestId('analysis-result')).toBeVisible();
  await page.getByTestId('question-input').fill('Why did the outage happen?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByTestId('message-completed').filter({ hasText: 'Assistant' })).toBeVisible({
    timeout: 30_000,
  });
});

test('ASK-07 failed analyses hide question input and show Retry', async ({ page }) => {
  const text = uniqueIncident(`${INC_OK} [MOCK:500]`);
  await page.goto('/new');
  await page.getByTestId('source-input').fill(text);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('form-error')).toBeVisible();
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.getByRole('link').filter({ hasText: 'failed' }).first().click();
  await expect(page.getByRole('heading', { name: 'Analysis failed' })).toBeVisible();
  await expect(page.getByTestId('question-input')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('ASK-08 double Ask creates one question pair', async ({ page }) => {
  await openCompletedAnalysis(page);
  await page.getByTestId('question-input').fill('Single question check');
  const ask = page.getByRole('button', { name: 'Ask' });
  await ask.dblclick();
  await expect(page.getByTestId('message-completed').filter({ hasText: 'Analyst' })).toHaveCount(1, {
    timeout: 30_000,
  });
});

test('ASK-10 per-user hourly question limit blocks the third question @limits-questions-2', async ({ page }) => {
  await openCompletedAnalysis(page);
  for (let index = 0; index < 2; index += 1) {
    await page.getByTestId('question-input').fill(`${followUpQuestion} ${index}`);
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(page.getByTestId('message-completed').filter({ hasText: 'Assistant' })).toHaveCount(index + 1, {
      timeout: 30_000,
    });
  }
  await page.getByTestId('question-input').fill(`${followUpQuestion} blocked`);
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByTestId('action-error')).toContainText('You exceeded the hourly question limit. Try again in');
});

test('ASK-11 context budget rejects long question without calling the model @limits-context', async ({ page }) => {
  await analyzeFromNew(page, uniqueIncident(INC_SHORT));
  const longQuestion = 'L'.repeat(400);
  await page.getByTestId('question-input').fill(longQuestion);
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByTestId('action-error')).toContainText(
    'The incident and the question exceed the context budget. The model was not called.',
  );
});
