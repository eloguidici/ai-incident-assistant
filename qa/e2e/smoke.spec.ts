import { expect, test } from '@playwright/test';

const incident =
  'On 2026-09-29 at 10:15 UTC the payments service returned HTTP 503 for 12 minutes. The load balancer showed unhealthy tasks. There was no deployment in that window.';

async function login(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Demo1234$');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'There are no analyses yet' }).or(page.getByRole('heading', { name: 'History' }))).toBeVisible();
}

test('walks through login, analysis, question, and history', async ({ page }) => {
  await login(page, 'demo1@demo.com');
  await expect(page.getByTestId('empty-history')).toBeVisible();
  await page.getByRole('link', { name: 'Create the first one' }).click();
  await page.getByTestId('source-input').fill(incident);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('analysis-result')).toBeVisible();
  await expect(page.getByTestId('evidence')).toContainText('payments service');
  await expect(page.getByTestId('uncertainty')).not.toBeEmpty();
  await page.getByRole('tab', { name: 'Questions' }).click();
  await page.getByTestId('question-input').fill('What information is missing to confirm the cause?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByText('Analyst')).toBeVisible();
  await expect(page.getByTestId('assistant-answer')).toBeVisible();
  await expect(page.getByTestId('assistant-answer')).not.toBeEmpty();
  await page.getByRole('link', { name: 'Back to history' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link').filter({ hasText: 'payments service' }).first()).toBeVisible();
});

test('shows a login error and keeps the script as text', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo1@demo.com');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('login-error')).toContainText('Invalid credentials');
  await login(page, 'demo1@demo.com');
  await page.goto('/new');
  const source = `${incident} Embedded text: <script>alert(1)</script>.`;
  await page.getByTestId('source-input').fill(source);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('source-text')).toContainText('<script>alert(1)</script>');
  const executedAlert = await page.evaluate(() => {
    const marker = document.querySelector('[data-testid="source-text"] script');
    return marker !== null;
  });
  expect(executedAlert).toBe(false);
});

test('another user cannot open the analysis by URL', async ({ browser, page }) => {
  await login(page, 'demo1@demo.com');
  await page.goto('/new');
  await page.getByTestId('source-input').fill(`${incident} Visible only to A.`);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('analysis-result')).toBeVisible();
  const url = page.url();
  await page.getByRole('button', { name: 'Sign out' }).click();
  const other = await browser.newPage();
  await login(other, 'demo2@demo.com');
  await other.goto(url);
  await expect(other.getByRole('alert')).toContainText('not found');
  await other.close();
});
