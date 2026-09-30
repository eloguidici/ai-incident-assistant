import OpenAI from 'openai';
import type { LlmConfig } from '../config/slices';
import { type LlmRequest, type LlmResponse } from './contracts';
import { mapOpenAiSdkError } from './openai.provider';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterProvider {
  readonly providerName = 'openrouter';
  private readonly client: OpenAI;
  private readonly maxOutputTokens: number;

  /**
   * @param llmSettings OpenRouter key, model id, per-attempt timeout, and completion token cap. Retries stay in the gateway.
   */
  constructor(llmSettings: LlmConfig) {
    this.maxOutputTokens = llmSettings.maxOutputTokens;
    this.client = new OpenAI({
      apiKey: llmSettings.apiKey,
      baseURL: OPENROUTER_BASE_URL,
      maxRetries: 0,
      timeout: llmSettings.attemptTimeoutMs,
    });
  }

  /**
   * Sends one chat completion in JSON mode through OpenRouter's OpenAI-compatible API.
   * @param request Prompt version, model, and messages.
   * @param signal Aborts the HTTP call.
   * @returns Raw model text, model name, and token usage when reported.
   * @throws ProviderRequestError mapped by {@link mapOpenAiSdkError}.
   */
  async complete(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    try {
      const response = await this.client.chat.completions.create(
        {
          model: request.model,
          temperature: 0.2,
          max_tokens: this.maxOutputTokens,
          response_format: { type: 'json_object' },
          messages: request.messages,
        },
        { signal },
      );
      return {
        rawText: response.choices[0]?.message?.content ?? '',
        provider: this.providerName,
        model: response.model || request.model,
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null,
      };
    } catch (error) {
      throw mapOpenAiSdkError(error);
    }
  }
}

/**
 * Base URL used for OpenRouter chat completions (OpenAI-compatible).
 * @returns The configured OpenRouter API root.
 */
export function openRouterBaseUrl(): string {
  return OPENROUTER_BASE_URL;
}
