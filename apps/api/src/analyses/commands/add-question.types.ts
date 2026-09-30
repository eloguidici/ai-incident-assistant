import type { AnalysisOwner } from '../analysis-command.shared';

/** Command input for {@link AddQuestionHandler}. */
export type AddQuestionCommand = {
  owner: AnalysisOwner;
  analysisId: string;
  question: string;
  correlationId: string;
  signal: AbortSignal;
};
