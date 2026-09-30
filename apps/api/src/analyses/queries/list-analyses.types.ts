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

/** Input for the list-analyses query after HTTP validation. */
export type ListAnalysesQuery = {
  ownerId: string;
  limit: number;
  offset: number;
};
