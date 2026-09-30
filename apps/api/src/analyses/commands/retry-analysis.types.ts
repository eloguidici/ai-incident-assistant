import type { AnalysisOwner } from '../analysis-command.shared';

/** Command input for {@link RetryAnalysisHandler}. */
export type RetryAnalysisCommand = {
  owner: AnalysisOwner;
  analysisId: string;
  correlationId: string;
  signal: AbortSignal;
};
