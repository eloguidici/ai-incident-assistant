import { z } from 'zod';

export const categorySchema = z.enum(['availability', 'performance', 'security', 'data', 'unknown']);
export const severitySchema = z.enum(['low', 'medium', 'high', 'critical', 'unknown']);
export const confidenceSchema = z.enum(['low', 'medium', 'high']);

/** Size limits of the model output contract. The schemas and the prompt text both read them. */
export const RESULT_LIMITS = {
  summaryChars: 2000,
  answerChars: 2000,
  uncertaintyChars: 1000,
  quoteChars: 500,
  noteChars: 500,
  statementChars: 500,
  missingItemChars: 300,
  maxListItems: 8,
} as const;

const evidenceSchema = z
  .object({
    quote: z.string().min(1).max(RESULT_LIMITS.quoteChars),
    note: z.string().min(1).max(RESULT_LIMITS.noteChars),
  })
  .strict();

const hypothesisSchema = z
  .object({
    statement: z.string().min(1).max(RESULT_LIMITS.statementChars),
    confidence: confidenceSchema,
  })
  .strict();

export const analysisResultSchema = z
  .object({
    summary: z.string().min(1).max(RESULT_LIMITS.summaryChars),
    category: categorySchema,
    suggestedSeverity: severitySchema,
    evidence: z.array(evidenceSchema).max(RESULT_LIMITS.maxListItems),
    hypotheses: z.array(hypothesisSchema).max(RESULT_LIMITS.maxListItems),
    missingInformation: z.array(z.string().min(1).max(RESULT_LIMITS.missingItemChars)).max(RESULT_LIMITS.maxListItems),
    uncertainty: z.string().max(RESULT_LIMITS.uncertaintyChars),
  })
  .strict();

export const questionResultSchema = analysisResultSchema.extend({
  answer: z.string().min(1).max(RESULT_LIMITS.answerChars),
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

export const ANALYSIS_PROMPT_VERSION = 'incident-analysis.v4';
export const QUESTION_PROMPT_VERSION = 'incident-question.v5';
