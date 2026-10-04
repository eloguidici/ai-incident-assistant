import { expect, type Locator, type Page, type Response } from '@playwright/test';
import type { AnalysisDetail, AnalysisResult } from '../../../apps/web/src/api';
import { applyPrivacyNames, privacyDisplayNames } from '../../../apps/web/src/components/PiiText';

export const entityTypes = ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER'] as const;
export type PrivacyLabels = Record<(typeof entityTypes)[number], string>;

const entityStyles = {
  PERSON: { className: 'person', color: 'rgb(12, 47, 29)', background: 'rgb(216, 239, 226)' },
  EMAIL_ADDRESS: { className: 'email', color: 'rgb(36, 92, 24)', background: 'rgb(229, 246, 212)' },
  PHONE_NUMBER: { className: 'phone', color: 'rgb(20, 52, 60)', background: 'rgb(215, 238, 243)' },
};

/**
 * Signs in through the real Compose UI using the existing synthetic demo account.
 * @param page Isolated browser page; no account is created or database reset performed.
 * @param email Existing demo analyst identity, outside incident sanitation.
 * @returns Resolves when authenticated history is displayed.
 * @throws Assertion failure if login or history loading fails.
 */
export async function login(page: Page, email = 'demo1@demo.com'): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Demo1234$');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'History', exact: true })
    .or(page.getByRole('heading', { name: 'There are no analyses yet' }))).toBeVisible();
}

/**
 * Rejects original synthetic entities, including partial names and reformatted phones, in returned content.
 * @param content Response object or visible text; never an outgoing request body.
 * @param sentinels Synthetic names, name parts, emails and phone numbers that must not be returned.
 * @returns Nothing on success.
 * @throws Assertion failure for any original sentinel or its JSON-escaped/normalized equivalent.
 */
export function assertNoOriginals(content: unknown, sentinels: readonly string[]): void {
  const serialized = typeof content === 'string' ? content : JSON.stringify(content);
  expect(typeof serialized).toBe('string');
  for (const sentinel of sentinels) {
    expect(serialized.toLowerCase(), `Original sentinel returned: ${sentinel}`).not.toContain(sentinel.toLowerCase());
    if (/^\+/.test(sentinel)) {
      expect(serialized.replace(/[^0-9]/g, ''), 'Original phone digits returned')
        .not.toContain(sentinel.replace(/[^0-9]/g, ''));
    }
  }
}

/**
 * Records actual content endpoint responses without routing, intercepting or altering HTTP traffic.
 * @param page Browser page whose analysis responses are observed.
 * @param sentinels Original synthetic PII prohibited in response bodies.
 * @returns An async assertion that detaches the observer and checks all captured responses.
 * @throws Assertion failure if no response was captured, decoding failed or an original leaked.
 */
export function observeContentResponses(page: Page, sentinels: readonly string[]): () => Promise<void> {
  const captures: Promise<{ body?: unknown; failure?: string }>[] = [];
  const capture = (response: Response) => {
    if (!/^\/api\/analyses(?:\/|$)/.test(new URL(response.url()).pathname)) return;
    captures.push(response.json().then(
      (body: unknown) => ({ body }),
      (failure: unknown) => ({ failure: String(failure) }),
    ));
  };
  page.on('response', capture);
  return async () => {
    page.off('response', capture);
    const responses = await Promise.all(captures);
    expect(responses.length, 'At least one real analysis response must be captured').toBeGreaterThan(0);
    for (const response of responses) {
      expect(response.failure, 'Content response must be readable JSON').toBeUndefined();
      assertNoOriginals(response.body, sentinels);
    }
  };
}

/**
 * Reads one exact, stable token per entity type from protected source text.
 * @param text Protected source containing the three synthetic contact entities.
 * @param occurrences Expected repetitions of each entity, including all repeated boundaries.
 * @returns Literal tokens keyed by backend entity type.
 * @throws Assertion failure for a missing, malformed, fragmented or unstable replacement.
 */
export function readLabels(text: string, occurrences: number): PrivacyLabels {
  const labels = {} as PrivacyLabels;
  for (const entityType of entityTypes) {
    const matches = text.match(new RegExp(`\\[${entityType}_[a-f0-9]{32}\\]`, 'g')) ?? [];
    expect(matches, `${entityType} must cover every expected occurrence`).toHaveLength(occurrences);
    expect(new Set(matches).size, `${entityType} must use one stable incident token`).toBe(1);
    labels[entityType] = matches[0]!;
  }
  return labels;
}

/**
 * Verifies the short privacy label and token-specific CSS in an actual browser.
 * @param scope One source, quote, message or narrative field container.
 * @param text Exact protected API text expected in that container.
 * @returns Resolves after all literal tokens and colors have been checked.
 * @throws Assertion failure for aliases, restored text, missing tokens or incorrect colors.
 */
export async function assertColoredText(scope: Locator, text: string): Promise<void> {
  const scopedTokens = await scope.evaluate((element) => {
    const root = element.closest('[data-privacy-scope]');
    if (!root) return null;
    return [...root.querySelectorAll('.pii-token')].map((node) => node.getAttribute('data-privacy-token') ?? '');
  });
  const names = privacyDisplayNames(scopedTokens ?? [text]);
  expect(await scope.textContent()).toBe(applyPrivacyNames(text, names));
  const matches = Array.from(text.matchAll(/\[(PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]/g));
  await expect(scope.locator('.pii-token')).toHaveCount(matches.length);
  for (let index = 0; index < matches.length; index += 1) {
    const token = scope.locator('.pii-token').nth(index);
    const entityStyle = entityStyles[matches[index][1] as keyof typeof entityStyles];
    expect(await token.textContent()).toBe(names.get(matches[index][0]));
    expect(await token.getAttribute('data-privacy-token')).toBe(matches[index][0]);
    await expect(token).toHaveClass(`pii-token pii-token--${entityStyle.className}`);
    await expect(token).toHaveCSS('color', entityStyle.color);
    await expect(token).toHaveCSS('background-color', entityStyle.background);
    await expect(token).not.toHaveAttribute('aria-label');
    await expect(token).not.toHaveAttribute('title');
  }
}

/**
 * Checks every narrative result field and preserves source-grounded evidence quotes.
 * @param scope Analysis or disclosed conversation result article.
 * @param result Validated response result with no hidden-answer section.
 * @param source Protected incident used to ground quotes.
 * @returns Resolves when every result field matches the actual API text and CSS.
 * @throws Assertion failure for changed citations, empty evidence or broken rendering.
 */
export async function assertResultRendering(scope: Locator, result: AnalysisResult, source: string): Promise<void> {
  await assertColoredText(scope.locator('section').first().locator('p').first(), result.summary);
  expect(result.evidence.length, 'A contact incident needs grounded evidence').toBeGreaterThan(0);
  const evidence = scope.getByTestId('evidence').locator('li');
  await expect(evidence).toHaveCount(result.evidence.length);
  for (let index = 0; index < result.evidence.length; index += 1) {
    const citation = result.evidence[index];
    expect(source).toContain(citation.quote);
    await assertColoredText(evidence.nth(index).locator('blockquote'), citation.quote);
    await assertColoredText(evidence.nth(index).locator('p'), citation.note);
  }
  const hypotheses = scope.getByTestId('hypotheses').locator('li');
  await expect(hypotheses).toHaveCount(result.hypotheses.length);
  for (let index = 0; index < result.hypotheses.length; index += 1) {
    const hypothesis = result.hypotheses[index];
    await assertColoredText(hypotheses.nth(index), `${hypothesis.statement} Confidence ${hypothesis.confidence}.`);
  }
  const missing = scope.getByTestId('missing').locator('li');
  await expect(missing).toHaveCount(result.missingInformation.length);
  for (let index = 0; index < result.missingInformation.length; index += 1) {
    await assertColoredText(missing.nth(index), result.missingInformation[index]);
  }
  await assertColoredText(scope.getByTestId('uncertainty').locator('p'), result.uncertainty || 'No uncertainty note.');
}

/**
 * Submits raw synthetic PII through the real UI and validates the actual successful content response.
 * @param page Signed-in browser page.
 * @param sourceText Synthetic incident sent to the real backend and configured detector/provider.
 * @param sentinels Prohibited original entities in incoming responses.
 * @returns Completed protected analysis; never retries a failed model output.
 * @throws Assertion failure on a leaked sentinel, failed status, invalid model output or missing result.
 */
export async function createAnalysis(page: Page, sourceText: string, sentinels: readonly string[]): Promise<AnalysisDetail> {
  await page.goto('/new');
  await page.getByTestId('source-input').fill(sourceText);
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/analyses' && response.request().method() === 'POST',
  { timeout: 90_000 });
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  const response = await responsePromise;
  const detail = await response.json() as AnalysisDetail;
  assertNoOriginals(detail, sentinels);
  expect(response.status(), 'Detector/provider failure is a failed test, not an accepted fallback').toBe(200);
  expect(detail.status).toBe('completed');
  expect(detail.result).not.toBeNull();
  await expect(page).toHaveURL(new RegExp(`/history/${detail.id}$`));
  await expect(page.getByTestId('analysis-result')).toBeVisible();
  return detail;
}

/**
 * Verifies actual token contrast, wrapping and ordered block layout without concealing overflow.
 * @param page Loaded detail/history page with all relevant disclosures open.
 * @returns Resolves after browser geometry and WCAG normal-text contrast checks.
 * @throws Assertion failure on horizontal overflow, overlapping blocks or contrast below 4.5:1.
 */
export async function assertResponsiveTokens(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const luminance = (color: string) => {
      const channels = color.match(/\d+/g)!.slice(0, 3).map((channel) => {
        const normalized = Number(channel) / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const tokens = Array.from(document.querySelectorAll<HTMLElement>('main .pii-token'));
    const overflow: string[] = [];
    const contrast: number[] = [];
    for (const token of tokens) {
      if (!token.getClientRects().length) continue;
      const style = getComputedStyle(token);
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      contrast.push((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05));
      for (const rect of token.getClientRects()) {
        if (rect.left < -1 || rect.right > innerWidth + 1) overflow.push(token.textContent ?? '');
      }
    }
    for (const block of document.querySelectorAll<HTMLElement>('main pre, main p, main blockquote, main li')) {
      if (block.getClientRects().length && block.scrollWidth > block.clientWidth + 1) overflow.push(block.tagName);
    }
    const overlaps: string[] = [];
    for (const parent of document.querySelectorAll('main section, main article, .thread, .thread-answer')) {
      const blocks = Array.from(parent.children).filter((child) =>
        child.getClientRects().length && getComputedStyle(child).display !== 'inline',
      );
      for (let index = 1; index < blocks.length; index += 1) {
        if (blocks[index].getBoundingClientRect().top < blocks[index - 1].getBoundingClientRect().bottom - 1) {
          overlaps.push(`${blocks[index - 1].tagName}/${blocks[index].tagName}`);
        }
      }
    }
    return { overflow, contrast, overlaps, pageOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(report.pageOverflow).toBe(false);
  expect(report.overflow).toEqual([]);
  expect(report.overlaps).toEqual([]);
  expect(report.contrast.length).toBeGreaterThan(0);
  for (const ratio of report.contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
}
