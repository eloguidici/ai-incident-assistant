import type { LlmConfig } from '../config/slices';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** OpenRouter chat completions through its OpenAI-compatible API. */
export class OpenRouterProvider extends OpenAiCompatibleProvider {
  /** @param llmSettings OpenRouter key, model id, per-attempt timeout, and completion token cap. */
  constructor(llmSettings: LlmConfig) {
    super('openrouter', llmSettings, OPENROUTER_BASE_URL);
  }
}

/**
 * Base URL used for OpenRouter chat completions (OpenAI-compatible).
 * @returns The configured OpenRouter API root.
 */
export function openRouterBaseUrl(): string {
  return OPENROUTER_BASE_URL;
}
