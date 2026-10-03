import { expect, test, type Locator, type Page } from '@playwright/test';
import { ANALYST_A, INC_OK, login, uniqueIncident, analyzeFromNew } from './helpers';

test('A11Y-03 login and form errors expose alert role', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ANALYST_A);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('login-error')).toHaveAttribute('role', 'alert');
  await login(page, ANALYST_A);
  await page.goto('/new');
  await page.getByTestId('source-input').fill(uniqueIncident(`${INC_OK} [MOCK:500]`));
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('form-error')).toHaveAttribute('role', 'alert');
});

test('A11Y-02 small viewport supports new analysis and ask flow without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await login(page, ANALYST_A);
  await analyzeFromNew(page, uniqueIncident(INC_OK));
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflowX).toBe(false);
  await page.getByTestId('question-input').fill('What information is missing to confirm the cause?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByTestId('assistant-answer')).toBeVisible({ timeout: 30_000 });
  const overflowAfterAsk = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowAfterAsk).toBe(false);
});

/**
 * Presses Tab (or Shift+Tab) until the target has focus.
 * @param page Page under test.
 * @param target Element that must receive focus.
 * @param key `Tab` to move forward, `Shift+Tab` to move back.
 * @throws Error when the target is not reached within 30 presses, so a broken tab order fails the test.
 */
async function tabTo(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab' = 'Tab'): Promise<void> {
  for (let step = 0; step < 30; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`Keyboard focus never reached ${target}`);
}

test('A11Y-01 keyboard navigation reaches sign-in analyze ask and sign-out', async ({ page }) => {
  await page.goto('/login');
  await tabTo(page, page.getByLabel('Email'));
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(ANALYST_A);
  await tabTo(page, page.getByLabel('Password'));
  await page.keyboard.type('Demo1234$');
  await tabTo(page, page.getByRole('button', { name: 'Sign in' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'History', exact: true }).or(page.getByTestId('empty-history'))).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#content')).toBeInViewport();

  await tabTo(page, page.getByRole('link', { name: 'New' }), 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/new$/);
  await tabTo(page, page.getByTestId('source-input'));
  // insertText is keyboard input without per-key events; typing thousands of characters key by key adds nothing here.
  await page.keyboard.insertText(uniqueIncident('Keyboard-only run: the payments service returned HTTP 503 for 12 minutes.'));
  await tabTo(page, page.getByRole('button', { name: 'Analyze' }));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('analysis-result')).toBeVisible({ timeout: 30_000 });

  await tabTo(page, page.getByTestId('question-input'));
  await page.keyboard.type('What is missing?');
  await tabTo(page, page.getByRole('button', { name: 'Ask' }));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('assistant-answer')).toBeVisible({ timeout: 30_000 });

  await tabTo(page, page.getByRole('button', { name: 'Sign out' }), 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/login$/);
});
