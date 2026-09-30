import OpenAI from 'openai';
import { loadAppConfig } from '../src/config/env';
import { llmConfig } from '../src/config/slices';
import { OpenRouterProvider, openRouterBaseUrl } from '../src/ai/openrouter.provider';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation((config: Record<string, unknown>) => {
    return {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
      __config: config,
    };
  });
});

describe('OpenRouterProvider', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"summary":"ok"}' } }],
      model: 'openai/gpt-4o-mini',
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    });
    process.env.LLM_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'sk-or-test-key-at-least-ten';
    process.env.OPENROUTER_MODEL = 'openai/gpt-4o-mini';
    process.env.OPENAI_API_KEY = '';
  });

  it('requires a key when the provider is openrouter', () => {
    process.env.OPENROUTER_API_KEY = '';
    expect(() => loadAppConfig()).toThrow(/OPENROUTER_API_KEY/);
  });

  it('configures the OpenAI SDK with the OpenRouter base URL', async () => {
    const settings = loadAppConfig().get(llmConfig);
    expect(settings.provider).toBe('openrouter');
    expect(settings.model).toBe('openai/gpt-4o-mini');
    const provider = new OpenRouterProvider(settings);
    expect(provider.providerName).toBe('openrouter');
    expect(openRouterBaseUrl()).toBe('https://openrouter.ai/api/v1');
    const OpenAiCtor = OpenAI as unknown as jest.Mock;
    expect(OpenAiCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://openrouter.ai/api/v1',
        maxRetries: 0,
      }),
    );
    await provider.complete(
      {
        promptVersion: 'incident-analysis.v1',
        model: settings.model,
        messages: [{ role: 'user', content: 'incident text long enough for the prompt' }],
      },
      new AbortController().signal,
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai/gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
