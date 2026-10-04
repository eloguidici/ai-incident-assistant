import { expect, test } from '@playwright/test';
import { assertColoredText, login } from './helpers';

const mode = process.env.PII_QA_MODE ?? 'full';
const person = 'Nora Vega';
const email = 'nora.fixture@example.test';
const phone = '+1 202-555-0147';
const source = `Operator ${person} reported HTTP 503. Email ${email}; phone ${phone}. Cause is unconfirmed.`;

test.describe(`operator protection flags: ${mode}`, () => {
  test('shows real runtime coverage, limits and processing state without silent text clipping', async ({ page }, testInfo) => {
    test.skip(mode === 'unavailable', 'Unavailable mode has its own failure scenario.');
    await login(page);
    await page.goto('/new');
    const configuration = await (await page.request.get('/api/analyses/limits')).json();
    expect(configuration).toEqual({ sourceTextMax: 1000, questionMax: 500,
      contentProtectionEnabled: mode !== 'disabled', personProtectionEnabled: mode === 'full' });
    const expectedMode = mode === 'disabled' ? 'Content protection disabled'
      : mode === 'contacts' ? 'Contact protection only: emails and phones. Names are not protected.'
      : 'Content protection enabled: names, emails and phones';
    await expect(page.getByTestId('content-protection-mode')).toHaveText(expectedMode);
    await expect(page.getByText('0/1000', { exact: true })).toBeVisible();
    const oversized = `${source} ${'x'.repeat(1001)}`;
    await page.getByTestId('source-input').fill(oversized);
    await expect(page.getByRole('button', { name: 'Analyze', exact: true })).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('maximum length');
    expect(await page.getByTestId('source-input').inputValue()).toBe(oversized);
    const csrf = (await page.context().cookies()).find(cookie => cookie.name === 'ia_csrf')!.value;
    const invalid = await page.request.post('/api/analyses', { data: { sourceText: oversized },
      headers: { 'x-csrf-token': decodeURIComponent(csrf) } });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error.code).toBe('VALIDATION_ERROR');
    await page.getByTestId('source-input').fill(source);
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/analyses') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    if (mode !== 'disabled') await expect(page.getByRole('status')).toContainText('Protecting detected');
    const response = await responsePromise;
    const created = await response.json();
    expect(response.status(), JSON.stringify(created)).toBe(200);
    expect(created.status).toBe('completed');
    expect(created.sourceText).toContain('HTTP 503');
    if (mode === 'disabled') {
      expect(created.sourceText).toBe(source);
    } else {
      expect(created.sourceText).not.toContain(email);
      expect(created.sourceText).not.toContain(phone);
      expect(created.sourceText).toMatch(/\[EMAIL_ADDRESS_[a-f0-9]{32}\]/);
      expect(created.sourceText).toMatch(/\[PHONE_NUMBER_[a-f0-9]{32}\]/);
      if (mode === 'full') expect(created.sourceText).not.toContain(person);
      else expect(created.sourceText).toContain(person);
    }
    await page.getByRole('tab', { name: 'Incident', exact: true }).click();
    await expect(page.getByTestId('source-text')).toBeVisible();
    await assertColoredText(page.getByTestId('source-text'), created.sourceText);
    await expect(page.getByTestId('content-protection-mode')).toHaveText(expectedMode);
    const oversizedQuestion = 'x'.repeat(501);
    await page.getByRole('tab', { name: 'Questions' }).click();
    await page.getByTestId('question-input').fill(oversizedQuestion);
    await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('maximum length');
    expect(await page.getByTestId('question-input').inputValue()).toBe(oversizedQuestion);
    const rejectedQuestion = await page.request.post(`/api/analyses/${created.id}/messages`, {
      data: { question: oversizedQuestion }, headers: { 'x-csrf-token': decodeURIComponent(csrf) },
    });
    expect(rejectedQuestion.status()).toBe(400);
    expect((await rejectedQuestion.json()).error.code).toBe('VALIDATION_ERROR');
    const question = `Did ${person} report HTTP 503? Contact email ${email}; phone ${phone}.`;
    await page.getByTestId('question-input').fill(question);
    const answerPromise = page.waitForResponse(response => response.url().endsWith(`/api/analyses/${created.id}/messages`)
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const answerResponse = await answerPromise;
    const answered = await answerResponse.json();
    expect(answerResponse.status(), JSON.stringify(answered)).toBe(200);
    expect(answered.messages).toHaveLength(2);
    const content = answered.messages[0].content as string;
    if (mode === 'disabled') expect(content).toBe(question);
    else {
      expect(content).not.toContain(email);
      expect(content).not.toContain(phone);
      for (const label of created.sourceText.match(/\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]/g) ?? []) {
        expect(content).toContain(label);
      }
      if (mode === 'full') expect(content).not.toContain(person);
      else expect(content).toContain(person);
    }
    await expect(page.getByTestId('assistant-answer')).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Incident', exact: true }).click();
    await expect(page.getByTestId('source-text')).toBeVisible();
    await assertColoredText(page.getByTestId('source-text'), created.sourceText);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`mode-${mode}-${width}.png`), fullPage: true });
    }
  });

  test('rejects detector outage instead of changing the flag or storing an unprotected incident', async ({ page }) => {
    test.skip(mode !== 'unavailable', 'Requires the battery to stop the real service first.');
    await login(page);
    const before = await (await page.request.get('/api/analyses?limit=1')).json();
    await page.goto('/new');
    await expect(page.getByTestId('content-protection-mode')).toContainText('Content protection enabled');
    await page.getByTestId('source-input').fill(source);
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/analyses') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    const response = await responsePromise;
    const body = await response.json();
    expect(response.status()).toBe(503);
    expect(body.error.code).toBe('PII_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain(email);
    await expect(page.getByTestId('form-error')).toContainText('Content protection is unavailable');
    await expect(page.getByTestId('content-protection-mode')).toContainText('Content protection enabled');
    await expect(page.getByTestId('source-input')).toHaveValue(source);
    await expect(page.getByRole('button', { name: 'Analyze', exact: true })).toBeEnabled();
    const after = await (await page.request.get('/api/analyses?limit=1')).json();
    expect(after.page.total).toBe(before.page.total);
  });
});
