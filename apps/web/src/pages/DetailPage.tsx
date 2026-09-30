import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, RunStatus, type AnalysisDetail } from '../api';
import { ResultView } from '../components/ResultView';

/**
 * Shows one analysis with its source text, result, conversation, retry button when failed, and question form when completed.
 * @returns The detail view, a loading message, or an error alert.
 */
export function DetailPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<AnalysisDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);

  /**
   * Fetches the analysis for the current id. On failure it clears the detail and shows the API message.
   * @returns A promise that settles after the state is updated. It never rejects.
   */
  function fetchDetail(): Promise<void> {
    return api<AnalysisDetail>(`/api/analyses/${id}`)
      .then(setDetail)
      .catch((failure: unknown) => {
        setDetail(null);
        setError(failure instanceof ApiError ? failure.message : 'The analysis could not be opened.');
      })
      .then(() => undefined);
  }

  function load(): Promise<void> {
    setError(null);
    return fetchDetail();
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /**
   * Sends the question and shows the updated thread. On failure it shows the error and reloads the stored thread.
   * @param event Form submit event. The default navigation is prevented.
   */
  async function ask(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const updatedAnalysis = await api<AnalysisDetail>(`/api/analyses/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
      setDetail(updatedAnalysis);
      setQuestion('');
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'The question could not be sent.');
      await fetchDetail();
    } finally {
      setPending(false);
    }
  }

  /** Runs the failed analysis again. On failure it shows the error and reloads the stored detail. */
  async function retry() {
    setPending(true);
    setError(null);
    try {
      setDetail(await api<AnalysisDetail>(`/api/analyses/${id}/retry`, { method: 'POST', body: '{}' }));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'The retry could not be started.');
      await fetchDetail();
    } finally {
      setPending(false);
    }
  }

  if (!detail && !error) return <p className="status">Loading analysis…</p>;
  if (!detail) return <p className="error" role="alert">{error}</p>;

  return (
    <section>
      <p className="eyebrow">Detail</p>
      <h1>Analysis {detail.status}</h1>
      <p className="meta" data-testid="model-meta">
        Prompt {detail.promptVersion ?? 'no version'} · model {detail.model ?? 'no model'} · expires{' '}
        {new Date(detail.expiresAt).toLocaleDateString('en-US')}
      </p>
      <h2>Submitted text</h2>
      <pre data-testid="source-text">{detail.sourceText}</pre>
      {detail.status === RunStatus.Failed ? (
        <div className="error" role="alert">
          <p>{detail.errorMessage}</p>
          <button type="button" onClick={() => void retry()} disabled={pending}>
            Retry
          </button>
        </div>
      ) : null}
      {detail.result ? <ResultView result={detail.result} /> : null}
      <h2>Conversation</h2>
      {detail.messages.length === 0 ? <p data-testid="no-messages">There are no questions yet.</p> : null}
      <ol className="thread">
        {detail.messages.map((message) => (
          <li key={message.id} data-testid={`message-${message.status}`}>
            <span className="meta">{message.role === 'user' ? 'Analyst' : 'Assistant'} · {message.status}</span>
            <p>{message.content}</p>
            {message.status === RunStatus.Completed && message.result ? <ResultView result={message.result} /> : null}
          </li>
        ))}
      </ol>
      {detail.status === RunStatus.Completed ? (
        <form onSubmit={(event) => void ask(event)}>
          <label>
            Question about this incident
            <textarea data-testid="question-input" value={question} onChange={(event) => setQuestion(event.target.value)} required />
          </label>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          {pending ? <p className="status">Asking…</p> : null}
          <button type="submit" disabled={pending || question.trim().length === 0}>
            Ask
          </button>
        </form>
      ) : null}
      <p>
        <Link to="/history">Back to history</Link>
      </p>
    </section>
  );
}
