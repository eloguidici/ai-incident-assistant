import type { AnalysisOwner } from '../analysis-command.shared';

/** Command input for {@link CreateAnalysisHandler}. */
export type CreateAnalysisCommand = {
  owner: AnalysisOwner;
  sourceText: string;
  correlationId: string;
  signal: AbortSignal;
};
