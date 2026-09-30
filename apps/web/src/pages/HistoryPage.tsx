import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type AnalysisListItem } from '../api';

/**
 * Lists the analyst's analyses, newest first, with an empty state when there are none.
 * @returns The list, the empty state, a loading message, or an error alert.
 */
export function HistoryPage() {
  const [analyses, setAnalyses] = useState<AnalysisListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: AnalysisListItem[] }>('/api/analyses')
      .then((analysisPage) => setAnalyses(analysisPage.items))
      .catch((failure: unknown) => setError(failure instanceof ApiError ? failure.message : 'The history could not be loaded.'));
  }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!analyses) return <p className="status">Loading history…</p>;
  if (analyses.length === 0) {
    return (
      <section data-testid="empty-history">
        <h1>There are no analyses yet</h1>
        <p>When you analyze an incident, it will appear in this list.</p>
        <Link to="/new">Create the first one</Link>
      </section>
    );
  }

  return (
    <section>
      <h1>History</h1>
      <ul className="list">
        {analyses.map((analysis) => (
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
    </section>
  );
}
