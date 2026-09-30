import type { AnalysisOwner } from '../analysis-command.shared';

/** CQRS command: create a new incident analysis. */
export class CreateAnalysisCommand {
  /**
   * @param owner Authenticated analyst.
   * @param sourceText Incident text to analyze.
   * @param correlationId Request correlation id for audit rows.
   * @param signal Aborted when the client disconnects or the deadline expires.
   */
  constructor(
    public readonly owner: AnalysisOwner,
    public readonly sourceText: string,
    public readonly correlationId: string,
    public readonly signal: AbortSignal,
  ) {}
}
