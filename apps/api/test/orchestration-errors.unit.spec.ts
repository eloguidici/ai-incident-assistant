import { OutputValidationError } from '../src/ai/validate';
import { toOrchestrationAppError } from '../src/analyses/analysis-orchestration.errors';
import { loadAppConfig } from '../src/config/env';
import { piiConfig } from '../src/config/slices';

describe('safe output-validation feedback', () => {
  it.each([
    'Model output is not JSON.',
    'The output does not match the analysis schema.',
    'The output does not match the question schema.',
    'A quote does not appear in the incident.',
    'The output includes a URL that is not in the incident.',
    'The assistant cannot claim to have performed external actions.',
    'Without quotes, the output must state uncertainty and missing information.',
    'The output includes a malformed privacy label.',
    'The output includes an unknown privacy label.',
    'The original contact details are not available.',
  ])('publishes only the fixed validation reason: %s', (reason) => {
    const failure = toOrchestrationAppError(new OutputValidationError(reason), 'analysis-id');
    expect(failure.errorCode).toBe('INVALID_OUTPUT');
    expect(failure.status).toBe(422);
    expect(failure.analysisId).toBe('analysis-id');
    expect(failure.message).toBe(`The model response could not be validated. ${reason} No result was accepted.`);
  });

  it('never exposes arbitrary exception text or provider content', () => {
    const failure = toOrchestrationAppError(new OutputValidationError('PRIVATE_SENTINEL@example.test'), 'analysis-id');
    expect(failure.message).toBe('The model response could not be validated. No result was accepted.');
    expect(failure.message).not.toContain('PRIVATE_SENTINEL');
  });

  it('accepts a bounded longer PII wait but rejects a value above 60 seconds', () => {
    const previous = process.env.PII_TIMEOUT_MS;
    try {
      process.env.PII_TIMEOUT_MS = '60000';
      expect(loadAppConfig().get(piiConfig).timeoutMs).toBe(60000);
      process.env.PII_TIMEOUT_MS = '60001';
      expect(() => loadAppConfig()).toThrow(/PII_TIMEOUT_MS/);
    } finally {
      if (previous === undefined) delete process.env.PII_TIMEOUT_MS;
      else process.env.PII_TIMEOUT_MS = previous;
    }
  });
});
