import { findTlsTrustDetail } from '../src/ai/network-cause';
import { ProviderRequestError } from '../src/ai/contracts';
import { LlmGateway } from '../src/ai/gateway';
import { answeredHistory, resolveQuestionContextWindow } from '../src/analyses/question-context';
import { buildAnalysisPrompt } from '../src/ai/prompt';
import { MockProvider, resetMockState } from '../src/ai/mock.provider';
import { ANALYSIS_PROMPT_VERSION } from '../src/ai/contracts';
import { validateAnalysis } from '../src/ai/validate';
import { selectContext } from '../src/ai/context';
import { InflightLimiter, SlidingWindowLimiter } from '../src/common/limiters';
import { stuckRecoveryCutoff, stuckRecoveryIntervalMs } from '../src/domain/recovery';
import { redactFields } from '../src/common/log';
import { loadAppConfig } from '../src/config/env';
import { llmConfig } from '../src/config/slices';
import { FIXTURES } from '../src/evaluation/fixtures';
import { scoreAnalysis } from '../src/evaluation/rubric';

const baseEnv = () => loadAppConfig().get(llmConfig);

describe('pure rules', () => {
  it('detects TLS trust failures in nested causes', () => {
    const root = new Error('Connection error.', {
      cause: new Error('fetch failed', {
        cause: Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }),
      }),
    });
    expect(findTlsTrustDetail(root)).toContain('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
  });

  it('rejects incomplete configuration without printing secrets', () => {
    const previousJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'short';
    expect(() => loadAppConfig()).toThrow(/JWT_SECRET/);
    process.env.JWT_SECRET = previousJwtSecret;
  });

  it('requires a key when the provider is openai', () => {
    const previousProvider = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = '';
    expect(() => loadAppConfig()).toThrow(/OPENAI_API_KEY/);
    process.env.LLM_PROVIDER = previousProvider;
    process.env.OPENAI_API_KEY = '';
  });

  it('requires a key when the provider is openrouter', () => {
    const previousProvider = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = '';
    expect(() => loadAppConfig()).toThrow(/OPENROUTER_API_KEY/);
    process.env.LLM_PROVIDER = previousProvider;
    process.env.OPENROUTER_API_KEY = '';
  });

  it('versions the prompt and drops the oldest context', () => {
    const prompt = buildAnalysisPrompt('incident text long enough for the prompt');
    expect(prompt.promptVersion).toBe(ANALYSIS_PROMPT_VERSION);
    expect(prompt.messages[0].content).toContain(ANALYSIS_PROMPT_VERSION);
    const contextWindow = selectContext('x'.repeat(100), [
      { role: 'user', content: 'a'.repeat(80) },
      { role: 'assistant', content: 'b'.repeat(80) },
    ], 'question', 400);
    expect(contextWindow.rejected).toBe(false);
    expect(contextWindow.history).toHaveLength(1);
    expect(contextWindow.history[0].content.startsWith('b')).toBe(true);
    expect(selectContext('x'.repeat(200), [], 'y'.repeat(80), 200).rejected).toBe(true);
  });

  it('rejects quotes that are not present and accepts uncertainty without evidence', () => {
    const source = 'The payments service returned HTTP 503 for 12 minutes.';
    expect(() =>
      validateAnalysis(
        JSON.stringify({
          summary: 'Summary',
          category: 'availability',
          suggestedSeverity: 'high',
          evidence: [{ quote: 'invented quote that is absent', note: 'note' }],
          hypotheses: [],
          missingInformation: [],
          uncertainty: '',
        }),
        source,
      ),
    ).toThrow(/quote/);
    const uncertainAnalysis = validateAnalysis(
      JSON.stringify({
        summary: 'Not enough',
        category: 'unknown',
        suggestedSeverity: 'unknown',
        evidence: [],
        hypotheses: [],
        missingInformation: ['Which service'],
        uncertainty: 'Context is missing.',
      }),
      source,
    );
    expect(uncertainAnalysis.evidence).toHaveLength(0);
  });

  it('does not copy sensitive fields into the log', () => {
    const redactedLog = redactFields({
      msg: 'request',
      status: 200,
      apiKey: 'sk-secret',
      sourceText: 'TOKEN-PII-998877',
      password: 'local-demo-password',
      authorization: 'Bearer abc',
    });
    expect(redactedLog).toEqual({ msg: 'request', status: 200 });
    expect(redactFields({ msg: 'persist_no_op', note: 'question_execution_already_closed', errorCode: 'OK' })).toEqual({
      msg: 'persist_no_op',
      note: 'question_execution_already_closed',
      errorCode: 'OK',
    });
    expect(JSON.stringify(redactedLog)).not.toContain('TOKEN-PII');
  });

  it('plans question context from prior history before the new user message is stored', () => {
    const window = resolveQuestionContextWindow(
      'source text long enough',
      [{ role: 'user', content: 'earlier question' }],
      'What failed?',
      400,
    );
    expect(window.history).toHaveLength(1);
    expect(window.history[0].content).toBe('earlier question');
  });

  it('leaves failed exchanges out of the question context', () => {
    const history = [
      { role: 'user', content: 'first question', status: 'completed' },
      { role: 'assistant', content: 'first answer', status: 'completed' },
      { role: 'user', content: 'broken question', status: 'completed' },
      { role: 'assistant', content: 'The model output did not match the contract.', status: 'failed' },
      { role: 'user', content: 'third question', status: 'completed' },
      { role: 'assistant', content: 'third answer', status: 'completed' },
    ];
    expect(answeredHistory(history).map((message) => message.content)).toEqual([
      'first question',
      'first answer',
      'third question',
      'third answer',
    ]);
    const window = resolveQuestionContextWindow('source text long enough', history, 'Next?', 2000);
    expect(window.history.map((message) => message.content)).not.toContain('broken question');
  });

  it('rejects retry backoff wait when the parent signal is already aborted', async () => {
    const env = baseEnv();
    let calls = 0;
    const flaky = {
      providerName: 'flaky',
      async complete() {
        calls += 1;
        if (calls === 1) throw new ProviderRequestError('server', 'temporary');
        return {
          rawText: '{}',
          provider: 'flaky',
          model: 'flaky-1',
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };
    const gateway = new LlmGateway(env, flaky);
    const controller = new AbortController();
    controller.abort('client');
    const prompt = buildAnalysisPrompt('incident text long enough for the prompt');
    await expect(gateway.complete(prompt, controller.signal, Date.now() + 5000)).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('schedules stuck recovery relative to the LLM deadline', () => {
    const deadlineMs = 2500;
    const cutoff = stuckRecoveryCutoff(deadlineMs, 10_000);
    expect(cutoff.getTime()).toBe(10_000 - deadlineMs - 5000);
    expect(stuckRecoveryIntervalMs(deadlineMs)).toBeGreaterThanOrEqual(15_000);
    expect(stuckRecoveryIntervalMs(deadlineMs)).toBeLessThanOrEqual(60_000);
  });

  it('limits bursts and concurrency', () => {
    const limiter = new SlidingWindowLimiter();
    expect(limiter.consume('user', 1, 60_000).ok).toBe(true);
    const rejectedAttempt = limiter.consume('user', 1, 60_000);
    expect(rejectedAttempt.ok).toBe(false);
    limiter.refund('user');
    expect(limiter.consume('user', 1, 60_000).ok).toBe(true);
    limiter.consume('other-user', 1, 1_000, 0);
    expect(limiter.consume('other-user', 1, 1_000, 5_000).ok).toBe(true);
    const inflight = new InflightLimiter(1);
    expect(inflight.tryEnter()).toBe(true);
    expect(inflight.tryEnter()).toBe(false);
    inflight.leave();
    expect(inflight.tryEnter()).toBe(true);
  });

  it('swaps the provider without changing validation', async () => {
    resetMockState();
    const env = baseEnv();
    const fixture = FIXTURES[0];
    const mockGateway = new LlmGateway(env, new MockProvider());
    const scripted = {
      providerName: 'scripted',
      async complete() {
        const quote = fixture.source.slice(0, 40);
        return {
          rawText: JSON.stringify({
            summary: 'Substitute provider result.',
            category: 'availability',
            suggestedSeverity: 'high',
            evidence: [{ quote, note: 'Quote from the incident.' }],
            hypotheses: [],
            missingInformation: ['Confirm metrics'],
            uncertainty: 'It remains a hypothesis.',
          }),
          provider: 'scripted',
          model: 'scripted-1',
          inputTokens: 3,
          outputTokens: 4,
        };
      },
    };
    const prompt = buildAnalysisPrompt(fixture.source);
    const signal = new AbortController().signal;
    const deadline = Date.now() + 5000;
    const mockOutcome = await mockGateway.complete(prompt, signal, deadline);
    const substituteOutcome = await new LlmGateway(env, scripted).complete(prompt, signal, deadline);
    expect(validateAnalysis(mockOutcome.response.rawText, fixture.source).evidence[0].quote.length).toBeGreaterThan(10);
    expect(validateAnalysis(substituteOutcome.response.rawText, fixture.source).summary).toContain('Substitute');
    expect(substituteOutcome.response.provider).toBe('scripted');
  });

  it('scores the mock fixtures', async () => {
    resetMockState();
    const provider = new MockProvider();
    for (const fixture of FIXTURES) {
      const prompt = buildAnalysisPrompt(fixture.source);
      const response = await provider.complete({ ...prompt, model: 'mock-incident-v1' }, new AbortController().signal);
      const analysis = validateAnalysis(response.rawText, fixture.source);
      expect(scoreAnalysis(fixture, analysis).pass).toBe(true);
    }
  });
});
