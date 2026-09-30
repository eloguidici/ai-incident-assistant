import OpenAI from 'openai';
import type { LlmConfig } from '../config/slices';
import { findTlsTrustDetail } from './network-cause';
import { ProviderRequestError, type LlmRequest, type LlmResponse } from './contracts';

export class OpenAiProvider {
  readonly providerName = 'openai';
  private readonly client: OpenAI;
  private readonly maxOutputTokens: number;

  /**
   * @param llmSettings OpenAI key, model, per-attempt timeout, and completion token cap. Retries stay in the gateway.
   */
  constructor(llmSettings: LlmConfig) {
    this.maxOutputTokens = llmSettings.maxOutputTokens;
    this.client = new OpenAI({
      apiKey: llmSettings.apiKey,
      maxRetries: 0,
      timeout: llmSettings.attemptTimeoutMs,
    });
  }

  /**
   * Sends one chat completion in JSON mode. The output is validated by the caller.
   * @param request Prompt version, model, and messages.
   * @param signal Aborts the HTTP call.
   * @returns Raw model text, model name, and token usage when reported.
   * @throws ProviderRequestError mapped by {@link mapOpenAiError}.
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
 * Translates an OpenAI SDK error into the provider error kinds used by the gateway.
 * @param error Anything thrown by the SDK call.
 * @returns A ProviderRequestError. Unknown errors become `network`.
 */
export function mapOpenAiSdkError(error: unknown): ProviderRequestError {
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new ProviderRequestError('timeout', 'The provider did not respond in time.');
  }
  if (error instanceof OpenAI.APIUserAbortError) {
    return new ProviderRequestError('cancelled', 'The request was cancelled.');
  }
  if (error instanceof ProviderRequestError) return error;
  if (error instanceof OpenAI.AuthenticationError) {
    return new ProviderRequestError('auth', 'The provider rejected the credential.', 401);
  }
  if (error instanceof OpenAI.RateLimitError) {
    const retryAfterHeader = error.headers?.get?.('retry-after');
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
    return new ProviderRequestError('rate_limit', 'The provider limited the request.', 429, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : undefined);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    const tlsDetail = findTlsTrustDetail(error);
    const message = tlsDetail
      ? `TLS trust failed while reaching the provider: ${tlsDetail}`
      : 'The provider could not be reached.';
    const mapped = new ProviderRequestError('network', message);
    mapped.cause = error;
    return mapped;
  }
  if (error instanceof OpenAI.APIError) {
    const status = typeof error.status === 'number' ? error.status : undefined;
    if (status !== undefined && status >= 500) return new ProviderRequestError('server', 'The provider failed.', status);
    return new ProviderRequestError('permanent', 'The provider rejected the request.', status);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new ProviderRequestError('cancelled', 'The request was cancelled.');
  }
  return new ProviderRequestError('network', 'The provider could not be reached.');
}
