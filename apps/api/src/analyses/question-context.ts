import { selectContext, type ContextMessage } from '../ai/context';
import { ErrorCode } from '../common/constants/error-code';
import { AppError } from '../common/http';

export type QuestionHistoryMessage = ContextMessage;

/**
 * Builds the context window for a follow-up question using prior messages only.
 * The current question is counted once in the budget, not again via history.
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
    priorHistory.map((message) => ({ role: message.role, content: message.content })),
    question,
    budget,
  );
  if (contextWindow.rejected) {
    throw new AppError(ErrorCode.ContextLimit, 413, 'The incident and the question exceed the context budget. The model was not called.');
  }
  return { history: contextWindow.history };
}
