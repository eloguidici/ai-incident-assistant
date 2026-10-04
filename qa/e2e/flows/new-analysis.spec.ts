import { expect, test } from '@playwright/test';
import { ANALYST_A, INC_HTML, INC_INJECTION, INC_OK, analysisTotal, login, uniqueIncident } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page, ANALYST_A);
});

test('NEW-02 Analyze stays disabled for empty or whitespace-only text', async ({ page }) => {
  await page.goto('/new');
  await expect(page.getByRole('button', { name: 'Analyze' })).toBeDisabled();
  await expect(page.getByText('0/8000')).toBeVisible();
  await page.getByTestId('source-input').fill('   ');
  await expect(page.getByRole('button', { name: 'Analyze' })).toBeDisabled();
  await expect(page.getByText('0/8000')).toBeVisible();
});

test('NEW-03 retains an over-limit draft and accepts the configured boundary', async ({ page }) => {
  await page.goto('/new');
  const { sourceTextMax } = await (await page.request.get('/api/analyses/limits')).json() as { sourceTextMax: number };
  const longText = 'x'.repeat(sourceTextMax + 100);
  await page.getByTestId('source-input').fill(longText);
  const value = await page.getByTestId('source-input').inputValue();
  expect(value).toBe(longText);
  await expect(page.getByRole('button', { name: 'Analyze' })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('maximum length');
  await page.getByTestId('source-input').fill('x'.repeat(sourceTextMax));
  await expect(page.getByText(`${sourceTextMax}/${sourceTextMax}`)).toBeVisible();
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('analysis-result')).toBeVisible({ timeout: 30_000 });
});

test('NEW-04 counter uses trimmed length', async ({ page }) => {
  await page.goto('/new');
  await page.getByTestId('source-input').fill('  abc  ');
  await expect(page.getByText('3/8000')).toBeVisible();
});

test('NEW-06 prompt injection shows result without claiming external actions', async ({ page }) => {
  const text = uniqueIncident(INC_INJECTION);
  await page.goto('/new');
  await page.getByTestId('source-input').fill(text);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('analysis-result')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('uncertainty')).toContainText(/no external action/i);
  const resultText = await page.getByTestId('analysis-result').innerText();
  expect(resultText.toLowerCase()).not.toMatch(/restarted the server/);
  expect(resultText).not.toMatch(/https?:\/\//);
});

test('NEW-07 double submit creates only one history item', async ({ page }) => {
  const before = await analysisTotal(page);
  const text = uniqueIncident(INC_OK);
  await page.goto('/new');
  await page.getByTestId('source-input').fill(text);
  await page.getByRole('button', { name: 'Analyze' }).dblclick();
  await expect(page.getByTestId('analysis-result')).toBeVisible({ timeout: 30_000 });
  expect(await analysisTotal(page)).toBe(before + 1);
});

test('NEW-08 provider error stays on /new and lists the analysis as failed', async ({ page }) => {
  const text = uniqueIncident(`${INC_OK} [MOCK:500]`);
  await page.goto('/new');
  await page.getByTestId('source-input').fill(text);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByTestId('form-error')).toContainText('The provider did not return a usable result.');
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page.getByRole('link').filter({ hasText: 'failed' }).first()).toBeVisible();
});

test('NEW-09 timeout shows deadline error on the form', async ({ page }) => {
  const text = uniqueIncident(`${INC_OK} [MOCK:timeout]`);
  await page.goto('/new');
  await page.getByTestId('source-input').fill(text);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('form-error')).toContainText(
    'The analysis did not finish within the time limit.',
    { timeout: 15_000 },
  );
});

test('NEW-10 invalid model output shows contract error for schema and invalid-json tags', async ({ page }) => {
  for (const [tag, reason] of [
    ['[MOCK:schema]', 'The output does not match the analysis schema.'],
    ['[MOCK:invalid-json]', 'Model output is not JSON.'],
  ]) {
    const text = uniqueIncident(`${INC_OK} ${tag}`);
    await page.goto('/new');
    await page.getByTestId('source-input').fill(text);
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByTestId('form-error')).toContainText(
      `The model response could not be validated. ${reason} No result was accepted.`,
    );
    await expect(page.getByRole('link', { name: 'View failed attempts' })).toHaveAttribute('href', '/history');
    await expect(page.getByTestId('source-input')).toHaveValue(text);
    await expect(page.getByTestId('analysis-result')).toHaveCount(0);
  }
});

test('NEW-10b an ungrounded quote is omitted and the analysis is shown', async ({ page }) => {
  const text = uniqueIncident(`${INC_OK} [MOCK:ungrounded]`);
  await page.goto('/new');
  await page.getByTestId('source-input').fill(text);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('analysis-result')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('analysis-result')).toContainText('There are no quotes grounded in the text.');
  await expect(page.getByTestId('analysis-result')).not.toContainText('THIS QUOTE IS NOT IN THE TEXT');
});

test('NEW-11 provider rejects credential shows auth error', async ({ page }) => {
  const text = uniqueIncident(`${INC_OK} [MOCK:auth]`);
  await page.goto('/new');
  await page.getByTestId('source-input').fill(text);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('form-error')).toContainText('The provider rejected the configured credential.');
});

test('NEW-12 provider rate limit shows limited request message', async ({ page }) => {
  const text = uniqueIncident(`${INC_OK} [MOCK:429]`);
  await page.goto('/new');
  await page.getByTestId('source-input').fill(text);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('form-error')).toContainText(
    'The provider limited the request. There was no infinite retry.',
  );
});

test('NEW-13 automatic retry after single provider failure still shows result', async ({ page }) => {
  const text = uniqueIncident(`${INC_OK} [MOCK:500-once]`);
  await page.goto('/new');
  await page.getByTestId('source-input').fill(text);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('analysis-result')).toBeVisible({ timeout: 30_000 });
});

test('NEW-14 per-user hourly analysis limit blocks the third request @limits-analyses-2', async ({ page }) => {
  for (let index = 0; index < 2; index += 1) {
    await page.goto('/new');
    await page.getByTestId('source-input').fill(uniqueIncident(`${INC_OK} limit-${index}`));
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByTestId('analysis-result')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('link', { name: 'Back to history' }).click();
  }
  await page.goto('/new');
  await page.getByTestId('source-input').fill(uniqueIncident(`${INC_OK} limit-blocked`));
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('form-error')).toContainText('You exceeded the hourly analysis limit. Try again in');
});
