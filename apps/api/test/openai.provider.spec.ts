import OpenAI from 'openai';
import { mapOpenAiSdkError } from '../src/ai/openai.provider';
import { ProviderRequestError } from '../src/ai/contracts';

describe('mapOpenAiSdkError', () => {
  it('maps connection timeouts', () => {
    const mapped = mapOpenAiSdkError(new OpenAI.APIConnectionTimeoutError());
    expect(mapped.kind).toBe('timeout');
  });

  it('maps authentication failures', () => {
    const headers = new Headers();
    const mapped = mapOpenAiSdkError(new OpenAI.AuthenticationError(401, undefined, 'bad key', headers));
    expect(mapped.kind).toBe('auth');
    expect(mapped.status).toBe(401);
  });

  it('maps rate limits', () => {
    const headers = new Headers({ 'retry-after': '2' });
    const mapped = mapOpenAiSdkError(new OpenAI.RateLimitError(429, undefined, 'limited', headers));
    expect(mapped.kind).toBe('rate_limit');
    expect(mapped.retryAfterMs).toBe(2000);
  });

  it('maps server errors', () => {
    const mapped = mapOpenAiSdkError(new OpenAI.InternalServerError(503, undefined, 'down', new Headers()));
    expect(mapped.kind).toBe('server');
    expect(mapped.status).toBe(503);
  });

  it('maps user abort and generic abort errors', () => {
    expect(mapOpenAiSdkError(new OpenAI.APIUserAbortError()).kind).toBe('cancelled');
    expect(mapOpenAiSdkError(Object.assign(new Error('aborted'), { name: 'AbortError' })).kind).toBe('cancelled');
  });

  it('passes through ProviderRequestError', () => {
    const original = new ProviderRequestError('network', 'already mapped');
    expect(mapOpenAiSdkError(original)).toBe(original);
  });

  it('maps unknown errors to network', () => {
    expect(mapOpenAiSdkError(new Error('boom')).kind).toBe('network');
  });
});
