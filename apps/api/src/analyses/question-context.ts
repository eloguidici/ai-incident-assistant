import { selectContext, type ContextMessage } from '../ai/context';
import { ErrorCode } from '../common/constants/error-code';
import { AppError } from '../common/http';
import { RunStatus } from '../domain/run-status';

/** A stored message. `status` is absent in callers that only hold role and content. */
export type QuestionHistoryMessage = ContextMessage & { status?: string };

/**
 * Drops failed exchanges: each failed assistant message and the analyst question right before it.
 * A failed answer was never shown as a result, so resending it would feed the model an error text
 * as if it were a prior answer and spend tokens on it.
 * @param history Stored messages, oldest first.
 * @returns The messages that may be sent to the model, oldest first.
 */
export function answeredHistory(history: QuestionHistoryMessage[]): QuestionHistoryMessage[] {
  const kept: QuestionHistoryMessage[] = [];
  for (const message of history) {
    if (message.role === 'assistant' && message.status === RunStatus.Failed) {
      if (kept.at(-1)?.role === 'user') kept.pop();
      continue;
    }
    kept.push(message);
  }
  return kept;
}

/**
 * Builds the context window for a follow-up question using prior messages only.
 * The current question is counted once in the budget, not again via history. Failed exchanges are left out.
 * @param source Incident text stored on the analysis.
 * @param priorHistory Messages already persisted, oldest first.
 * @param question New analyst question (not yet stored).
 * @param budget Character budget for the model context.
 * @returns Trimmed history for the prompt.
 * @throws AppError CONTEXT_LIMIT when source and question alone exceed the budget.
 */
export function resolveQuestionContextWindow(
  source: string,
  priorHistory: QuestionHistoryMessage[],
  question: string,
  budget: number,
): { history: QuestionHistoryMessage[] } {
  const contextWindow = selectContext(
    source,
    answeredHistory(priorHistory).map((message) => ({ role: message.role, content: message.content })),
    question,
    budget,
  );
  if (contextWindow.rejected) {
    throw new AppError(ErrorCode.ContextLimit, 413, 'The incident and the question exceed the context budget. The model was not called.');
  }
  return { history: contextWindow.history };
}
