import { expect, test } from '@playwright/test';
import { ANALYST_A, INC_OK, login, uniqueIncident, analyzeFromNew } from './helpers';

test('AUTH-03 empty fields trigger native required validation without login error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('');
  await page.getByLabel('Email').fill('');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('login-error')).toHaveCount(0);
  const emailInvalid = await page.getByLabel('Email').evaluate((el) => !(el as HTMLInputElement).checkValidity());
  expect(emailInvalid).toBe(true);
});

test('AUTH-04 guarded routes redirect to login without a session', async ({ page }) => {
  for (const path of ['/history', '/new', '/history/00000000-0000-4000-8000-000000000000']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in to analyze an incident' })).toBeVisible();
  }
});

test('AUTH-06 session survives reload on history', async ({ page }) => {
  await login(page, ANALYST_A);
  await page.goto('/history');
  await expect(page.getByText(ANALYST_A)).toBeVisible();
  await page.reload();
  await expect(page.getByText(ANALYST_A)).toBeVisible();
  await expect(page).not.toHaveURL(/\/login$/);
});

test('AUTH-07 session cookies use HttpOnly session and readable CSRF', async ({ page, context }) => {
  await login(page, ANALYST_A);
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === 'ia_session');
  const csrf = cookies.find((cookie) => cookie.name === 'ia_csrf');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  expect(csrf?.httpOnly).toBe(false);
  const csrfFromDocument = await page.evaluate(() => {
    const match = document.cookie.split('; ').find((part) => part.startsWith('ia_csrf='));
    return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
  });
  expect(csrfFromDocument).toBe(csrf?.value);
});

test.describe('limits session @limits-session', () => {
  test('AUTH-08 expired session redirects to login after JWT TTL', async ({ page }) => {
    await login(page, ANALYST_A);
    await analyzeFromNew(page, uniqueIncident(INC_OK));
    const analysisUrl = page.url();
    await page.waitForTimeout(62_000);
    await page.getByRole('link', { name: 'History', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Email').fill(ANALYST_A);
    await page.getByLabel('Password').fill('Demo1234$');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
    await page.goto(analysisUrl);
    await expect(page.getByTestId('analysis-result')).toBeVisible();
  });

  test('AUTH-09 sign-in lockout after repeated failures', async ({ page }) => {
    await page.goto('/login');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByLabel('Email').fill(ANALYST_A);
      await page.getByLabel('Password').fill('wrong-password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByTestId('login-error')).toContainText('Invalid credentials');
    }
    await page.getByLabel('Password').fill('Demo1234$');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('login-error')).toContainText('Too many sign-in attempts. Try again in');
    await expect(page).toHaveURL(/\/login$/);
  });
});
