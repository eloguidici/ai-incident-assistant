import { OpenAiProvider } from '../src/ai/openai.provider';
import { OpenRouterProvider } from '../src/ai/openrouter.provider';
import { loadAppConfig } from '../src/config/env';
import { llmConfig } from '../src/config/slices';
import type { LlmRequest } from '../src/ai/contracts';

const request: LlmRequest = { model: 'test-model', promptVersion: 'test.v1', messages: [{ role: 'user', content: 'Synthetic incident' }] };

describe.each([
  ['openai', OpenAiProvider, 'https://api.openai.com/v1/chat/completions'],
  ['openrouter', OpenRouterProvider, 'https://openrouter.ai/api/v1/chat/completions'],
] as const)('%s transport contract', (providerName, Provider, endpoint) => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the expected request through the SDK and preserves metadata', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"summary":"synthetic"}' } }], model: 'resolved-model',
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new Provider({ ...loadAppConfig().get(llmConfig), apiKey: 'synthetic-test-key', maxOutputTokens: 512 });
    const result = await provider.complete(request, new AbortController().signal);
    expect(result).toEqual({ rawText: '{"summary":"synthetic"}', provider: providerName, model: 'resolved-model', inputTokens: 12, outputTokens: 7 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe(endpoint);
    const options = fetch.mock.calls[0][1];
    expect(JSON.parse(options?.body as string)).toMatchObject({ model: 'test-model', max_tokens: 512, messages: request.messages, response_format: { type: 'json_object' } });
    expect(options?.signal).toBeDefined();
  });

  it('maps a server failure without hidden SDK retries', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"error":{"message":"unavailable"}}', {
      status: 503, headers: { 'content-type': 'application/json' },
    }));
    const provider = new Provider({ ...loadAppConfig().get(llmConfig), apiKey: 'synthetic-test-key' });
    await expect(provider.complete(request, new AbortController().signal)).rejects.toMatchObject({ kind: 'server', status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('honors an already aborted call without contacting the provider', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    const provider = new Provider({ ...loadAppConfig().get(llmConfig), apiKey: 'synthetic-test-key' });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.complete(request, controller.signal)).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
