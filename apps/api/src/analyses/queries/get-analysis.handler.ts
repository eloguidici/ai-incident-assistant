import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-code';
import { AppError } from '../../common/http';
import { AnalysisCommandShared } from '../analysis-command.shared';
import type { AnalysisDetailResult } from '../analysis-detail.types';
import type { GetAnalysisQuery } from './get-analysis.types';

/** CQRS query handler: loads one analysis detail for the owner. */
@Injectable()
export class GetAnalysisHandler {
  /** @param shared Loads and maps persistence detail without LLM calls. */
  constructor(private readonly shared: AnalysisCommandShared) {}

  /**
   * @param query Owner and analysis id.
   * @returns Detail with messages and executions.
   * @throws AppError NOT_FOUND when the row is missing or not owned.
   */
  async execute(query: GetAnalysisQuery): Promise<AnalysisDetailResult> {
    const detail = await this.shared.loadDetail(query.ownerId, query.analysisId);
    if (!detail) throw new AppError(ErrorCode.NotFound, 404, 'That analysis was not found.');
    return detail;
  }
}
