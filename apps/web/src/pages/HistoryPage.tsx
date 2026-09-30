import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type AnalysisListItem } from '../api';

const PAGE_SIZE = 20;

type HistoryPageResponse = {
  items: AnalysisListItem[];
  page: { limit: number; offset: number; total: number };
};

/**
 * Lists the analyst's analyses, newest first, with an empty state when there are none.
 * @returns The list, the empty state, a loading message, or an error alert.
 */
export function HistoryPage() {
  const [page, setPage] = useState<HistoryPageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setPage(null);
    api<HistoryPageResponse>(`/api/analyses?limit=${PAGE_SIZE}&offset=${offset}`, { signal: controller.signal })
      .then((response) => setPage(response))
      .catch((failure: unknown) => {
        if (failure instanceof DOMException && failure.name === 'AbortError') return;
        setError(failure instanceof ApiError ? failure.message : 'The history could not be loaded.');
      });
    return () => controller.abort();
  }, [offset]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!page) return <p className="status">Loading history…</p>;
  if (page.items.length === 0 && page.page.total === 0) {
    return (
      <section data-testid="empty-history">
        <h1>There are no analyses yet</h1>
        <p>When you analyze an incident, it will appear in this list.</p>
        <Link to="/new">Create the first one</Link>
      </section>
    );
  }

  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < page.page.total;

  return (
    <section>
      <h1>History</h1>
      <p className="meta" data-testid="history-page-meta">
        Showing {offset + 1}–{Math.min(offset + page.items.length, page.page.total)} of {page.page.total}
      </p>
      <ul className="list">
        {page.items.map((analysis) => (
          <li key={analysis.id}>
            <Link to={`/history/${analysis.id}`}>
              <strong>{analysis.summary || 'Analysis without a summary'}</strong>
              <span>{analysis.excerpt}</span>
              <span className="meta">
                {analysis.status} · {new Date(analysis.createdAt).toLocaleString('en-US')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="pager">
        <button type="button" disabled={!canPrev} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>
          Previous
        </button>
        <button type="button" disabled={!canNext} onClick={() => setOffset((value) => value + PAGE_SIZE)}>
          Next
        </button>
      </div>
    </section>
  );
}
