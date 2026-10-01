import { expect, test, type Page } from '@playwright/test';
import { ANALYST_A, ANALYST_B, INC_OK, analysisIdFromUrl, analyzeFromNew, login, uniqueIncident } from './helpers';

// The history list shows only the first characters of each text, so isolation is asserted by analysis id, not by text.
const historyLink = (page: Page, id: string) => page.locator(`a[href="/history/${id}"]`);

test('ISO-02 user B history never lists user A analyses', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await login(pageA, ANALYST_A);
  await analyzeFromNew(pageA, uniqueIncident(INC_OK));
  const idA = analysisIdFromUrl(pageA);
  await pageA.goto('/history');
  await expect(historyLink(pageA, idA)).toHaveCount(1);
  await login(pageB, ANALYST_B);
  await pageB.goto('/history');
  await expect(pageB.getByRole('heading', { name: 'There are no analyses yet' }).or(pageB.getByRole('heading', { name: 'History', exact: true }))).toBeVisible();
  await expect(historyLink(pageB, idA)).toHaveCount(0);
  await contextA.close();
  await contextB.close();
});

test('ISO-03 parallel sessions stay isolated', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await login(pageA, ANALYST_A);
  await login(pageB, ANALYST_B);
  await analyzeFromNew(pageA, uniqueIncident(INC_OK));
  const idA = analysisIdFromUrl(pageA);
  await analyzeFromNew(pageB, uniqueIncident(INC_OK));
  const idB = analysisIdFromUrl(pageB);
  await pageA.goto('/history');
  await pageB.goto('/history');
  await expect(historyLink(pageA, idA)).toHaveCount(1);
  await expect(historyLink(pageA, idB)).toHaveCount(0);
  await expect(historyLink(pageB, idB)).toHaveCount(1);
  await expect(historyLink(pageB, idA)).toHaveCount(0);
  await pageB.goto(`/history/${idA}`);
  await expect(pageB.getByRole('alert')).toContainText('That analysis was not found.');
  await contextA.close();
  await contextB.close();
});
