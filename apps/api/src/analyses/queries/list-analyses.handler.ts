import { Inject, Injectable } from '@nestjs/common';
import { AnalysisListExcerptLength } from '../../common/constants/pagination';
import type { AnalysisRepository } from '../../db/repositories/analysis.repository';
import { ANALYSIS_REPOSITORY } from '../../db/repositories/tokens';
import { readSeverity, readSummary } from '../analysis-list.helpers';
import type { ListAnalysesQuery, ListAnalysesResult } from './list-analyses.types';

/** CQRS query handler: lists analyses for one owner (reference vertical for R00-B). */
@Injectable()
export class ListAnalysesHandler {
  /** @param analyses Persistence port for list and count queries. */
  constructor(@Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository) {}

  /**
   * Lists one analyst's analyses, newest first.
   * @param query Owner id and validated pagination.
   * @returns Summaries and excerpts. Full source text stays out of the list.
   */
  async execute(query: ListAnalysesQuery): Promise<ListAnalysesResult> {
    const rows = await this.analyses.listByOwner(query.ownerId, query.limit, query.offset);
    const total = await this.analyses.countByOwner(query.ownerId);
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        excerpt: row.sourceText.slice(0, AnalysisListExcerptLength),
        summary: readSummary(row.result),
        suggestedSeverity: readSeverity(row.result),
        errorCode: row.errorCode,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
      page: { limit: query.limit, offset: query.offset, total },
    };
  }
}
