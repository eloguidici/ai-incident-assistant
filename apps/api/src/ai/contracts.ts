import { z } from 'zod';

export const categorySchema = z.enum(['availability', 'performance', 'security', 'data', 'unknown']);
export const severitySchema = z.enum(['low', 'medium', 'high', 'critical', 'unknown']);
export const confidenceSchema = z.enum(['low', 'medium', 'high']);

const evidenceSchema = z
  .object({
    quote: z.string().min(1).max(500),
    note: z.string().min(1).max(500),
  })
  .strict();

const hypothesisSchema = z
  .object({
    statement: z.string().min(1).max(500),
    confidence: confidenceSchema,
  })
  .strict();

export const analysisResultSchema = z
  .object({
    summary: z.string().min(1).max(2000),
    category: categorySchema,
    suggestedSeverity: severitySchema,
    evidence: z.array(evidenceSchema).max(8),
    hypotheses: z.array(hypothesisSchema).max(8),
    missingInformation: z.array(z.string().min(1).max(300)).max(8),
    uncertainty: z.string().max(1000),
  })
  .strict();

export const questionResultSchema = analysisResultSchema.extend({
  answer: z.string().min(1).max(2000),
}).strict();

export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type QuestionResult = z.infer<typeof questionResultSchema>;

export type ChatMessage = { role: 'system' | 'user'; content: string };

export type LlmRequest = {
  promptVersion: string;
  model: string;
  messages: ChatMessage[];
};

export type LlmResponse = {
  rawText: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type ProviderErrorKind = 'timeout' | 'rate_limit' | 'server' | 'network' | 'auth' | 'cancelled' | 'permanent';

export class ProviderRequestError extends Error {
  attempts = 1;

  /**
   * @param kind Failure class used for the retry decision and the public error code.
   * @param message Internal description. It is not shown to the analyst as-is.
   * @param status HTTP status returned by the provider, when there was one.
   * @param retryAfterMs Delay requested by the provider before another attempt.
   */
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/**
 * Tells whether another attempt may succeed for this failure kind.
 * @returns True for timeout, rate_limit, server, and network. False otherwise.
 */
export function isRetryable(kind: ProviderErrorKind): boolean {
  return kind === 'timeout' || kind === 'rate_limit' || kind === 'server' || kind === 'network';
}

export const ANALYSIS_PROMPT_VERSION = 'incident-analysis.v1';
export const QUESTION_PROMPT_VERSION = 'incident-question.v2';
