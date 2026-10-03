import { expect, test } from '@playwright/test';

const incident =
  'On 2026-09-29 at 10:15 UTC the payments service returned HTTP 503 for 12 minutes. The load balancer showed unhealthy tasks. There was no deployment in that window.';

test('synthetic demo of login, analysis, and question', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo1@demo.com');
  await page.getByLabel('Password').fill('Demo1234$');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'New' }).click();
  await page.getByTestId('source-input').fill(incident);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('analysis-result')).toBeVisible();
  await page.getByTestId('question-input').fill('What is missing to confirm the cause?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByText('Analyst')).toBeVisible();
});
