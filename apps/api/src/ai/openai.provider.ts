import type { LlmConfig } from '../config/slices';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

export { mapOpenAiSdkError } from './openai-compatible.provider';

/** OpenAI chat completions through the official endpoint. */
export class OpenAiProvider extends OpenAiCompatibleProvider {
  /** @param llmSettings OpenAI key, model, per-attempt timeout, and completion token cap. */
  constructor(llmSettings: LlmConfig) {
    super('openai', llmSettings);
  }
}
