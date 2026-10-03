import { expect, type APIRequestContext, type Page } from '@playwright/test';
export { INC_HTML, INC_INJECTION, INC_OK, INC_SHORT } from '../../fixtures/incident-texts';

export const PASSWORD = 'Demo1234$';

export const ANALYST_A = 'demo1@demo.com';
export const ANALYST_B = 'demo2@demo.com';

/** Appends a run-unique suffix so mock fault counters and history rows do not collide. */
export function uniqueIncident(base: string): string {
  return `${base} [run:${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
}

/**
 * Signs in and waits until the history shell is ready.
 * @param page Browser page.
 * @param email Analyst email.
 */
export async function login(page: Page, email: string = ANALYST_A): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page
      .getByRole('heading', { name: 'There are no analyses yet' })
      .or(page.getByRole('heading', { name: 'History', exact: true })),
  ).toBeVisible();
}

/**
 * Creates a completed analysis from /new and waits on the detail view.
 * @param page Signed-in page.
 * @param sourceText Incident text (should be unique per test).
 */
export async function analyzeFromNew(page: Page, sourceText: string): Promise<void> {
  await page.goto('/new');
  await page.getByTestId('source-input').fill(sourceText);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('analysis-result')).toBeVisible({ timeout: 30_000 });
}

/**
 * Reads the analysis id from a detail URL such as `/history/<id>`.
 * @param page Page currently showing an analysis detail.
 * @returns The analysis id.
 * @throws Error when the page is not on a detail route.
 */
export function analysisIdFromUrl(page: Page): string {
  const match = new URL(page.url()).pathname.match(/^\/history\/([0-9a-f-]{36})$/);
  if (!match) throw new Error(`Not on an analysis detail page: ${page.url()}`);
  return match[1];
}

/**
 * Reads the total number of analyses the signed-in user owns.
 * @param page Signed-in page (its cookies are used).
 * @returns `page.total` from the list endpoint.
 */
export async function analysisTotal(page: Page): Promise<number> {
  const response = await page.request.get('/api/analyses?limit=1');
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { page: { total: number } }).page.total;
}

/**
 * Creates an analysis via the API using the page session cookies.
 * @param page Signed-in page (for cookies).
 * @param sourceText Incident text.
 * @returns Created analysis id.
 */
export async function createAnalysisViaApi(page: Page, sourceText: string): Promise<string> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'ia_csrf')?.value;
  const response = await page.request.post('/api/analyses', {
    headers: csrf ? { 'x-csrf-token': csrf } : {},
    data: { sourceText },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { id: string };
  return body.id;
}

/**
 * Bulk-creates analyses with the API (for pagination tests).
 * @param request Playwright request context with session cookies from storage state or prior login.
 * @param csrf CSRF token value.
 * @param count How many analyses to create.
 * @param sourcePrefix Prefix for unique source text.
 */
export async function createManyAnalysesViaApi(
  request: APIRequestContext,
  csrf: string,
  count: number,
  sourcePrefix: string,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const response = await request.post('/api/analyses', {
      headers: { 'x-csrf-token': csrf },
      data: { sourceText: uniqueIncident(`${sourcePrefix} bulk-${index}`) },
    });
    expect(response.ok()).toBeTruthy();
  }
}

/** Reads ia_csrf from the browser cookie jar. */
export async function readCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'ia_csrf')?.value;
  expect(csrf).toBeTruthy();
  return csrf!;
}
