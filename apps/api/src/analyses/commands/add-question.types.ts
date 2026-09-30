import type { AnalysisOwner } from '../analysis-command.shared';

/** CQRS command: append a follow-up question to a completed analysis. */
export class AddQuestionCommand {
  /**
   * @param owner Authenticated analyst.
   * @param analysisId Target analysis id.
   * @param question Follow-up question text.
   * @param correlationId Request correlation id for audit rows.
   * @param signal Aborted when the client disconnects or the deadline expires.
   */
  constructor(
    public readonly owner: AnalysisOwner,
    public readonly analysisId: string,
    public readonly question: string,
    public readonly correlationId: string,
    public readonly signal: AbortSignal,
  ) {}
}
