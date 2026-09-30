import type { LlmOutcome } from '../ai/gateway';
import { providerFailure } from '../ai/gateway';
import { ProviderRequestError } from '../ai/contracts';
import { OutputValidationError } from '../ai/validate';
import { ErrorCode } from '../common/constants/error-code';
import { AppError } from '../common/http';

/**
 * Maps orchestration failures to a public {@link AppError}, preserving provider attempt counts when present.
 * @param error Failure from the gateway, validation, or persistence layer.
 * @param analysisId Owning analysis when the row already exists.
 * @param outcome Provider metrics when the model returned before the failure.
 */
export function toOrchestrationAppError(error: unknown, analysisId: string, outcome?: LlmOutcome): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ProviderRequestError) {
    const attempts = outcome?.attempts ?? error.attempts;
    if (attempts !== error.attempts) error.attempts = attempts;
    return providerFailure(error, analysisId);
  }
  if (error instanceof OutputValidationError) {
    return new AppError(
      ErrorCode.InvalidOutput,
      422,
      'The model output did not match the contract and is not shown as a result.',
      analysisId,
    );
  }
  return new AppError(
    ErrorCode.DataNotSaved,
    500,
    'The result could not be saved. It was not marked as successful.',
    analysisId,
  );
}

/**
 * @param outcome Successful gateway metrics when the model completed.
 * @param error Original failure, used for attempt counts on provider errors.
 */
export function orchestrationAttemptCount(outcome: LlmOutcome | undefined, error: unknown): number {
  if (outcome) return outcome.attempts;
  if (error instanceof ProviderRequestError) return error.attempts;
  return 1;
}
