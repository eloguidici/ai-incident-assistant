import type { AppError } from '../common/http';
import type { LlmOutcome } from '../ai/gateway';

/** Inputs required to persist a failed question run (orchestration layer). */
export type QuestionFailureRecord = {
  ownerId: string;
  analysisId: string;
  question: string;
  appError: AppError;
  sourceError: unknown;
  outcome: LlmOutcome | undefined;
  correlationId: string;
  executionId: string;
  userMessageStored: boolean;
};
