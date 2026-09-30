import type { AnalysisOwner } from '../analysis-command.shared';

/** CQRS command: retry a failed analysis. */
export class RetryAnalysisCommand {
  /**
   * @param owner Authenticated analyst.
   * @param analysisId Failed analysis to retry.
   * @param correlationId Request correlation id for audit rows.
   * @param signal Aborted when the client disconnects or the deadline expires.
   */
  constructor(
    public readonly owner: AnalysisOwner,
    public readonly analysisId: string,
    public readonly correlationId: string,
    public readonly signal: AbortSignal,
  ) {}
}
