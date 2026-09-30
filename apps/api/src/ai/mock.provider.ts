import type { AnalysisResult, QuestionResult } from './contracts';
import { ANALYSIS_PROMPT_VERSION, ProviderRequestError, QUESTION_PROMPT_VERSION, type LlmRequest, type LlmResponse } from './contracts';
import { MockFaultTag } from './mock-fault-tags';

const onceCalls = new Map<string, number>();

/** Clears the call counters used by the server-once and server-twice mock tags. */
export function resetMockState(): void {
  onceCalls.clear();
}

/**
 * Extracts the incident text between the prompt delimiters.
 * @param promptText Joined prompt messages.
 * @returns The incident text, or an empty string when the delimiters are missing.
 */
function incidentOf(promptText: string): string {
  const match = promptText.match(/<<<INCIDENT id=([0-9a-f]+)\n([\s\S]*?)\nINCIDENT id=\1>>>/);
  return match?.[2] ?? '';
}

/**
 * Picks a short quote that appears verbatim in the source.
 * @returns A quote of 12 to 80 characters, or null when none qualifies.
 */
function excerpt(source: string): string | null {
  const match = source.match(/[\p{L}0-9][^[\]]{15,160}/u);
  if (!match) return null;
  const quote = match[0].slice(0, 80).trim();
  return quote.length >= 12 && source.includes(quote) ? quote : null;
}

/**
 * Guesses the incident category from keywords in the source.
 * @returns The first matching category, or `unknown`.
 */
function categoryOf(source: string): AnalysisResult['category'] {
  if (/503|504|unhealthy|unavailable|not responding/i.test(source)) return 'availability';
  if (/slow|latency/i.test(source)) return 'performance';
  if (/credential|intrusion|injection|ignore|script/i.test(source)) return 'security';
  if (/corrupt|data loss/i.test(source)) return 'data';
  return 'unknown';
}

/** @returns An analysis that states the text is not enough, with no evidence or hypotheses. */
function insufficient(): AnalysisResult {
  return {
    summary: 'The text is not enough to describe an incident.',
    category: 'unknown',
    suggestedSeverity: 'unknown',
    evidence: [],
    hypotheses: [],
    missingInformation: ['Which service failed', 'When it started', 'What impact was observed'],
    uncertainty: 'There is not enough evidence to assert a cause.',
  };
}

/**
 * Builds a deterministic analysis grounded in a quote from the source.
 * @returns The insufficient-text analysis when the source is short or has no usable quote.
 */
function analysisFrom(source: string): AnalysisResult {
  const quote = excerpt(source);
  if (!quote || source.trim().length < 40) return insufficient();
  const injected = /ignor|<script/i.test(source);
  return {
    summary: 'The text describes an observed failure. The cause is not confirmed.',
    category: categoryOf(source),
    suggestedSeverity: /503|500/.test(source) ? 'high' : 'unknown',
    evidence: [{ quote, note: 'Fragment present in the submitted text.' }],
    hypotheses: [
      {
        statement: 'The mentioned service may have a problem, but the text does not isolate the cause.',
        confidence: 'low',
      },
    ],
    missingInformation: ['Recent changes', 'Scope of affected users'],
    uncertainty: injected
      ? 'The text includes embedded instructions or markup. No external action was run.'
      : 'The cause remains a hypothesis until it is checked against metrics and changes.',
  };
}

/**
 * Builds a deterministic answer on top of {@link analysisFrom}.
 * @returns The analysis fields plus an answer that does not claim a confirmed cause.
 */
function questionFrom(source: string): QuestionResult {
  const base = analysisFrom(source);
  return {
    ...base,
    answer: base.evidence.length
      ? 'The answer relies only on a fragment of the original incident. It does not confirm the cause.'
      : 'The incident does not contain enough evidence to answer with certainty.',
  };
}

/** @returns All message contents of the request joined by newlines, used to detect mock tags. */
function requestTextOf(request: LlmRequest): string {
  return request.messages.map((message) => message.content).join('\n');
}

export class MockProvider {
  readonly providerName = 'mock';

  /**
   * Returns a deterministic response, or simulates a provider failure when the request contains a mock fault tag.
   * @param request Prompt version and messages. The model name is ignored.
   * @param signal Used by the timeout tag, which waits until it aborts.
   * @returns Raw JSON text and the mock model name. Token counts are null.
   * @throws ProviderRequestError for auth, rate limit, server, timeout, and should-not-run tags.
   */
  async complete(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    const requestText = requestTextOf(request);
    // Block ids are random per request; strip them so a retried request maps to the same fault counter.
    const callKey = requestText.replace(/\b[0-9a-f]{24}\b/g, '*');
    if (requestText.includes(MockFaultTag.ShouldNotRun)) {
      throw new ProviderRequestError('permanent', 'The provider should not have been called.');
    }
    if (requestText.includes(MockFaultTag.Timeout)) {
      await waitForAbort(signal);
    }
    if (requestText.includes(MockFaultTag.Auth)) throw new ProviderRequestError('auth', 'credential rejected', 401);
    if (requestText.includes(MockFaultTag.RateLimit)) throw new ProviderRequestError('rate_limit', '429', 429, 30);
    if (requestText.includes(MockFaultTag.ServerOnce)) {
      const seen = (onceCalls.get(callKey) ?? 0) + 1;
      onceCalls.set(callKey, seen);
      if (seen === 1) throw new ProviderRequestError('server', '500', 500);
    }
    if (requestText.includes(MockFaultTag.ServerTwice)) {
      const seen = (onceCalls.get(`twice:${callKey}`) ?? 0) + 1;
      onceCalls.set(`twice:${callKey}`, seen);
      if (seen <= 2) throw new ProviderRequestError('server', '500', 500);
    }
    if (requestText.includes(MockFaultTag.Server)) throw new ProviderRequestError('server', '500', 500);
    const source = incidentOf(requestText);
    let rawText = '{';
    if (requestText.includes(MockFaultTag.InvalidJson)) rawText = '{';
    else if (requestText.includes(MockFaultTag.Schema)) rawText = JSON.stringify({ hello: 'no' });
    else if (requestText.includes(MockFaultTag.Ungrounded)) {
      rawText = JSON.stringify({
        ...analysisFrom(source.length > 40 ? source : `${source} filler text for the schema`),
        evidence: [{ quote: 'THIS QUOTE IS NOT IN THE TEXT', note: 'Invented by the test double.' }],
        uncertainty: 'This output must be rejected.',
      });
    } else if (request.promptVersion === QUESTION_PROMPT_VERSION) rawText = JSON.stringify(questionFrom(source));
    else if (request.promptVersion === ANALYSIS_PROMPT_VERSION) rawText = JSON.stringify(analysisFrom(source));
    else rawText = JSON.stringify(analysisFrom(source));
    return {
      rawText,
      provider: this.providerName,
      model: 'mock-incident-v1',
      inputTokens: null,
      outputTokens: null,
    };
  }
}

/**
 * Waits until the signal aborts.
 * @returns A promise that never resolves.
 * @throws ProviderRequestError `cancelled` when the signal aborts, immediately if it already has.
 */
function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new ProviderRequestError('cancelled', 'cancelled'));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
  });
}
