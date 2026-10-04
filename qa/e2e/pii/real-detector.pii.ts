import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { AnalysisDetail, AnalysisListItem } from '../../../apps/web/src/api';
import {
  assertColoredText,
  assertNoOriginals,
  assertResponsiveTokens,
  assertResultRendering,
  createAnalysis,
  entityTypes,
  login,
  observeContentResponses,
  readLabels,
  type PrivacyLabels,
} from './helpers';

type ContactFixture = {
  language: string;
  person: string;
  email: string;
  phone: string;
  prefix: string;
  emailLabel: string;
  phoneLabel: string;
};

const contacts: ContactFixture[] = [
  { language: 'English', person: 'Alice Morgan', email: 'alice.morgan@example.com', phone: '+1 202-555-0147',
    prefix: 'Operator', emailLabel: 'email', phoneLabel: 'phone' },
  { language: 'Spanish', person: 'Mar\u00eda G\u00f3mez', email: 'maria.gomez@example.com', phone: '+54 9 11 5555-0101',
    prefix: 'La operadora', emailLabel: 'correo', phoneLabel: 'tel\u00e9fono' },
  { language: 'Mixed', person: 'Robert Taylor', email: 'robert.taylor@example.com', phone: '+34 612 345 678',
    prefix: 'El operador', emailLabel: 'email', phoneLabel: 'tel\u00e9fono' },
];

/**
 * Builds raw, synthetic contact content with repeated entities and useful technical facts.
 * @param contact Fictional corpus-style name, email and phone; not real customer data.
 * @returns A run-unique incident, with each contact entity repeated exactly twice.
 */
function incidentText(contact: ContactFixture): string {
  return `${contact.prefix} ${contact.person}; ${contact.emailLabel} ${contact.email}; ${contact.phoneLabel} ${contact.phone}. ` +
    `HTTP 503 from api-1 at 14:30 UTC. Ticket INC-2048.\n` +
    `${contact.person} confirmed the same alert. ${contact.emailLabel}: ${contact.email}; ${contact.phoneLabel}: ${contact.phone}. ` +
    `Cause is unconfirmed. Run ${randomUUID()}. ` +
    'Captured payload: <img src=x onerror="document.body.dataset.piiInjected=1">.';
}

/**
 * Lists complete and partial synthetic identities that must never be returned as incident content.
 * @param contact Synthetic contact used in this test.
 * @returns Name parts, full name, email and phone sentinels; account identity is excluded.
 */
function originalSentinels(contact: ContactFixture): string[] {
  return [contact.person, ...contact.person.split(' '), contact.email, contact.phone];
}

/**
 * Computes the exact expected protected text without changing anything except the three known entities.
 * @param text Raw synthetic source or question.
 * @param contact Entities whose occurrences are expected to be replaced.
 * @param labels Literal tokens observed from the real detector response.
 * @returns The expected text, preserving all technical facts, markup and whitespace.
 */
function expectedProtectedText(text: string, contact: ContactFixture, labels: PrivacyLabels): string {
  return text.replaceAll(contact.person, labels.PERSON)
    .replaceAll(contact.email, labels.EMAIL_ADDRESS)
    .replaceAll(contact.phone, labels.PHONE_NUMBER);
}

/**
 * Fetches persisted detail using the browser's actual session cookies.
 * @param page Authenticated browser page.
 * @param id Analysis owned by that session.
 * @param sentinels Original entities prohibited in the response.
 * @returns The successful protected detail, with no model invocation or write.
 * @throws Assertion failure on rejection or any raw sentinel in the response.
 */
async function persistedDetail(page: Page, id: string, sentinels: readonly string[]): Promise<AnalysisDetail> {
  const response = await page.request.get(`/api/analyses/${id}`);
  const detail = await response.json() as AnalysisDetail;
  assertNoOriginals(detail, sentinels);
  expect(response.status()).toBe(200);
  return detail;
}

/**
 * Reads the newest owned records without resetting or seeding the database.
 * @param page Authenticated browser page.
 * @param sentinels Original entities prohibited in list response fields.
 * @returns The first fifty list entries from the real API.
 * @throws Assertion failure on a rejected request or returned original entity.
 */
async function ownedHistory(page: Page, sentinels: readonly string[]): Promise<AnalysisListItem[]> {
  const response = await page.request.get('/api/analyses?limit=50&offset=0');
  const history = await response.json() as { items: AnalysisListItem[] };
  assertNoOriginals(history, sentinels);
  expect(response.status()).toBe(200);
  return history.items;
}

test.describe('T22 real PII detector through Compose HTTP and browser', () => {
  for (const contact of contacts) {
    test(`${contact.language}: exact colored tokens survive source, results, questions, reload and history`, async ({ page, request }, testInfo) => {
      const health = await request.get('/api/health');
      expect(health.status(), 'Existing Compose stack and configured detector must be ready').toBe(200);
      const sentinels = originalSentinels(contact);
      const checkResponses = observeContentResponses(page, sentinels);
      await login(page);
      const source = incidentText(contact);
      const created = await createAnalysis(page, source, sentinels);
      const labels = readLabels(created.sourceText, 2);
      expect(created.sourceText).toBe(expectedProtectedText(source, contact, labels));
      await page.getByRole('tab', { name: 'Incident', exact: true }).click();
      await expect(page.getByTestId('source-text')).toBeVisible();
      await assertColoredText(page.getByTestId('source-text'), created.sourceText);
      await page.getByRole('tab', { name: 'Result', exact: true }).click();
      await assertResultRendering(page.getByTestId('analysis-result'), created.result!, created.sourceText);
      assertNoOriginals(await page.locator('main').textContent(), sentinels);
      await expect(page.locator('main img, main script')).toHaveCount(0);
      expect(await page.locator('body').getAttribute('data-pii-injected')).toBeNull();

      const question = `Did ${contact.person} confirm HTTP 503? Contact email ${contact.email}; phone ${contact.phone}. ` +
        'Which facts remain unconfirmed?';
      await page.getByRole('tab', { name: 'Questions' }).click();
      await page.getByTestId('question-input').fill(question);
      const questionResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/analyses/${created.id}/messages` && response.request().method() === 'POST',
      { timeout: 90_000 });
      await page.getByRole('button', { name: 'Ask', exact: true }).click();
      const questionResponse = await questionResponsePromise;
      const answered = await questionResponse.json() as AnalysisDetail;
      assertNoOriginals(answered, sentinels);
      expect(questionResponse.status(), 'Invalid detector/model output must fail this flow').toBe(200);
      expect(answered.messages).toHaveLength(2);
      const userMessage = answered.messages[0];
      const assistantMessage = answered.messages[1];
      expect(userMessage.role).toBe('user');
      expect(userMessage.status).toBe('completed');
      expect(userMessage.content).toBe(expectedProtectedText(question, contact, labels));
      expect(readLabels(userMessage.content, 1)).toEqual(labels);
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.status).toBe('completed');
      expect(assistantMessage.result).not.toBeNull();
      const answer = assistantMessage.result!;
      for (const match of JSON.stringify(answer).matchAll(/\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]/g)) {
        expect(Object.values(labels), 'Assistant must not fabricate or borrow a foreign privacy label').toContain(match[0]);
      }
      await expect(page.getByTestId('question-input')).toHaveValue('');
      await expect(page.getByTestId('assistant-answer')).toBeVisible();
      await assertColoredText(page.locator('.thread > li').first().locator('p'), userMessage.content);
      await assertColoredText(page.getByTestId('assistant-answer'), answer.answer);
      await page.getByText('Evidence, hypotheses, and uncertainty', { exact: true }).click();
      await assertResultRendering(page.getByTestId('thread-result-detail'), answer, created.sourceText);
      assertNoOriginals(await page.locator('main').textContent(), sentinels);

      await page.reload();
      await page.getByRole('tab', { name: 'Incident', exact: true }).click();
      await expect(page.getByTestId('source-text')).toBeVisible();
      const reloaded = await persistedDetail(page, created.id, sentinels);
      expect(reloaded.sourceText).toBe(created.sourceText);
      expect(reloaded.result).toEqual(created.result);
      expect(reloaded.messages).toEqual(answered.messages);
      await assertColoredText(page.getByTestId('source-text'), reloaded.sourceText);
      await page.getByRole('tab', { name: 'Questions', exact: true }).click();
      await assertColoredText(page.getByTestId('assistant-answer'), answer.answer);
      await page.getByText('Evidence, hypotheses, and uncertainty', { exact: true }).click();
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await assertResponsiveTokens(page);
        if (width === 390) await page.screenshot({ path: testInfo.outputPath('pii-detail-390.png'), fullPage: true });
      }

      await page.getByRole('link', { name: 'Back to history', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
      const owned = await ownedHistory(page, sentinels);
      const historyRecord = owned.find((analysis) => analysis.id === created.id);
      expect(historyRecord).toBeDefined();
      const record = historyRecord!;
      expect(created.sourceText.startsWith(record.excerpt)).toBe(true);
      for (const entityType of entityTypes) expect(record.excerpt).toContain(labels[entityType]);
      const historyLink = page.locator(`.list a[href="/history/${created.id}"]`);
      await assertColoredText(historyLink.locator(':scope > strong'), record.summary || 'Analysis without a summary');
      await assertColoredText(historyLink.locator(':scope > span').first(), record.excerpt);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await assertResponsiveTokens(page);
        if (width === 390) await page.screenshot({ path: testInfo.outputPath('pii-history-390.png'), fullPage: true });
      }
      await page.reload();
      await expect(historyLink).toBeVisible();
      await assertColoredText(historyLink.locator(':scope > span').first(), record.excerpt);
      await historyLink.click();
      await page.getByRole('tab', { name: 'Incident', exact: true }).click();
      await expect(page.getByTestId('source-text')).toBeVisible();
      await assertColoredText(page.getByTestId('source-text'), created.sourceText);
      await page.getByRole('tab', { name: 'Questions', exact: true }).click();
      await assertColoredText(page.getByTestId('assistant-answer'), answer.answer);
      assertNoOriginals(await page.locator('main').textContent(), sentinels);
      await checkResponses();
      await testInfo.attach('configured-provider.json', {
        body: JSON.stringify({ provider: created.provider, model: created.model, questionExecutionModel: answered.executions.at(-1)?.model ?? null }),
        contentType: 'application/json',
      });
    });
  }

  test('incident and user labels stay isolated; foreign detail, questions and retry are denied without originals', async ({ browser, page }, testInfo) => {
    const contact = contacts[0];
    const sentinels = originalSentinels(contact);
    const checkResponsesA = observeContentResponses(page, sentinels);
    await login(page);
    const source = incidentText(contact);
    const first = await createAnalysis(page, source, sentinels);
    const second = await createAnalysis(page, source, sentinels);
    expect(second.id).not.toBe(first.id);
    const firstLabels = readLabels(first.sourceText, 2);
    const secondLabels = readLabels(second.sourceText, 2);
    expect(first.sourceText).toBe(expectedProtectedText(source, contact, firstLabels));
    expect(second.sourceText).toBe(expectedProtectedText(source, contact, secondLabels));
    for (const entityType of entityTypes) expect(secondLabels[entityType]).not.toBe(firstLabels[entityType]);
    expect((await persistedDetail(page, first.id, sentinels)).sourceText).toBe(first.sourceText);
    expect((await persistedDetail(page, second.id, sentinels)).sourceText).toBe(second.sourceText);

    const otherContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const other = await otherContext.newPage();
      const checkResponsesB = observeContentResponses(other, sentinels);
      await login(other, 'demo2@demo.com');
      const third = await createAnalysis(other, source, sentinels);
      const thirdLabels = readLabels(third.sourceText, 2);
      expect(third.sourceText).toBe(expectedProtectedText(source, contact, thirdLabels));
      for (const entityType of entityTypes) {
        expect(thirdLabels[entityType]).not.toBe(firstLabels[entityType]);
        expect(thirdLabels[entityType]).not.toBe(secondLabels[entityType]);
      }
      const historyA = await ownedHistory(page, sentinels);
      const historyB = await ownedHistory(other, sentinels);
      expect(historyA.some((analysis) => analysis.id === first.id)).toBe(true);
      expect(historyA.some((analysis) => analysis.id === second.id)).toBe(true);
      expect(historyA.some((analysis) => analysis.id === third.id)).toBe(false);
      expect(historyB.some((analysis) => analysis.id === third.id)).toBe(true);
      expect(historyB.some((analysis) => [first.id, second.id].includes(analysis.id))).toBe(false);
      await other.goto('/history');
      await expect(other.locator(`a[href="/history/${first.id}"]`)).toHaveCount(0);
      await expect(other.locator(`a[href="/history/${second.id}"]`)).toHaveCount(0);
      await other.goto(`/history/${first.id}`);
      await expect(other.getByRole('alert')).toContainText('That analysis was not found.');
      await expect(other.getByTestId('source-text')).toHaveCount(0);
      await expect(other.getByTestId('analysis-result')).toHaveCount(0);
      assertNoOriginals(await other.locator('main').textContent(), sentinels);

      for (const [caller, foreignId] of [[other, first.id], [page, third.id]] as const) {
        const cookies = await caller.context().cookies();
        const csrf = cookies.find((cookie) => cookie.name === 'ia_csrf')?.value;
        expect(csrf).toBeDefined();
        const headers = { 'x-csrf-token': decodeURIComponent(csrf!) };
        const deniedResponses = [
          await caller.request.get(`/api/analyses/${foreignId}`),
          await caller.request.post(`/api/analyses/${foreignId}/messages`, { headers, data: { question: `Did ${contact.person} confirm HTTP 503?` } }),
          await caller.request.post(`/api/analyses/${foreignId}/retry`, { headers, data: {} }),
        ];
        for (const response of deniedResponses) {
          const body = await response.json();
          assertNoOriginals(body, sentinels);
          expect(response.status()).toBe(404);
          expect(body.error.code).toBe('NOT_FOUND');
          expect(body.sourceText).toBeUndefined();
          expect(body.result).toBeUndefined();
          expect(body.messages).toBeUndefined();
        }
      }
      expect((await persistedDetail(page, first.id, sentinels)).messages).toEqual([]);
      expect((await persistedDetail(other, third.id, sentinels)).messages).toEqual([]);
      await checkResponsesB();
      await testInfo.attach('configured-provider.json', {
        body: JSON.stringify({ provider: first.provider, model: first.model }), contentType: 'application/json',
      });
    } finally {
      await otherContext.close();
    }
    await checkResponsesA();
  });
});
