import type { RunStatus } from '../../domain/run-status';

/** One row in the paginated analysis list returned by {@link ListAnalysesHandler}. */
export type AnalysisListItem = {
  id: string;
  status: RunStatus;
  excerpt: string;
  summary: string | null;
  suggestedSeverity: string | null;
  errorCode: string | null;
  createdAt: string;
  expiresAt: string;
};

/** Paginated list response for `GET /analyses`. */
export type ListAnalysesResult = {
  items: AnalysisListItem[];
  page: { limit: number; offset: number; total: number };
};

/** CQRS query: paginated analysis list for one owner. */
export class ListAnalysesQuery {
  /**
   * @param ownerId Authenticated analyst id.
   * @param limit Page size after HTTP validation.
   * @param offset Rows to skip after HTTP validation.
   */
  constructor(
    public readonly ownerId: string,
    public readonly limit: number,
    public readonly offset: number,
  ) {}
}
