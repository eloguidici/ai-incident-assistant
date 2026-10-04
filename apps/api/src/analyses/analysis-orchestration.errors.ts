import type { LlmOutcome } from '../ai/gateway';
import { providerFailure } from '../ai/gateway';
import { ProviderRequestError } from '../ai/contracts';
import { OutputValidationError } from '../ai/validate';
import { ErrorCode } from '../common/constants/error-code';
import { AppError } from '../common/http';

const PUBLIC_VALIDATION_REASONS = new Set([
  'Model output is not JSON.',
  'The output does not match the analysis schema.',
  'The output does not match the question schema.',
  'A quote does not appear in the incident.',
  'The output includes a URL that is not in the incident.',
  'The assistant cannot claim to have performed external actions.',
  'Without quotes, the output must state uncertainty and missing information.',
  'The output includes a malformed privacy label.',
  'The output includes an unknown privacy label.',
  'The original contact details are not available.',
]);

/**
 * Maps orchestration failures to a public {@link AppError}, preserving provider attempt counts when present.
 * @param error Failure from the gateway, validation, or persistence layer.
 * @param analysisId Owning analysis when the row already exists.
 * @param outcome Provider metrics when the model returned before the failure.
 */
export function toOrchestrationAppError(error: unknown, analysisId: string, outcome?: LlmOutcome): AppError {
  if (error instanceof AppError) return error.analysisId ? error : new AppError(
    error.errorCode, error.status, error.message, analysisId, error.retryAfterSeconds,
  );
  if (error instanceof ProviderRequestError) {
    const attempts = outcome?.attempts ?? error.attempts;
    if (attempts !== error.attempts) error.attempts = attempts;
    return providerFailure(error, analysisId);
  }
  if (error instanceof OutputValidationError) {
    const reason = PUBLIC_VALIDATION_REASONS.has(error.message) ? ` ${error.message}` : '';
    return new AppError(
      ErrorCode.InvalidOutput,
      422,
      `The model response could not be validated.${reason} No result was accepted.`,
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
