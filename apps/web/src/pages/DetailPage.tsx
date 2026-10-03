import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, RunStatus, type AnalysisDetail, type QuestionResult } from '../api';
import { ResultView } from '../components/ResultView';
import { PiiText } from '../components/PiiText';
import { useContentLimits } from '../hooks/useContentLimits';

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
  const { limits, error: limitsError } = useContentLimits();
  const tooLong = Boolean(limits && question.trim().length > limits.questionMax);
  // The analysis on screen. Ask and retry responses that arrive after navigation must not overwrite it.
  const shownId = useRef(id);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    shownId.current = id;
    setError(null);
    setDetail(null);
    setPending(false);
    setQuestion('');
    api<AnalysisDetail>(`/api/analyses/${id}`, { signal: controller.signal })
      .then((loadedDetail) => {
        if (!active || controller.signal.aborted) return;
        setDetail(loadedDetail);
      })
      .catch((failure: unknown) => {
        if (!active || (failure instanceof DOMException && failure.name === 'AbortError')) return;
        setDetail(null);
        setError(failure instanceof ApiError ? failure.message : 'The analysis could not be opened.');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [id]);

  /**
   * Sends the question and shows the updated thread. On failure it shows the error and reloads the stored thread.
   * @param event Form submit event. The default navigation is prevented.
   */
  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!limits || tooLong || pending) return;
    const requestId = id;
    const stillShown = () => shownId.current === requestId;
    setPending(true);
    setError(null);
    try {
      const updatedAnalysis = await api<AnalysisDetail>(`/api/analyses/${requestId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
      if (!stillShown()) return;
      setDetail(updatedAnalysis);
      setQuestion('');
    } catch (failure) {
      if (!stillShown()) return;
      setError(failure instanceof ApiError ? failure.message : 'The question could not be sent.');
      try {
        const reloaded = await api<AnalysisDetail>(`/api/analyses/${requestId}`);
        if (stillShown()) setDetail(reloaded);
      } catch {
        /* keep the last good detail */
      }
    } finally {
      if (stillShown()) setPending(false);
    }
  }

  /** Runs the failed analysis again. On failure it shows the error and reloads the stored detail. */
  async function retry() {
    const requestId = id;
    const stillShown = () => shownId.current === requestId;
    setPending(true);
    setError(null);
    try {
      const retried = await api<AnalysisDetail>(`/api/analyses/${requestId}/retry`, { method: 'POST', body: '{}' });
      if (stillShown()) setDetail(retried);
    } catch (failure) {
      if (!stillShown()) return;
      setError(failure instanceof ApiError ? failure.message : 'The retry could not be started.');
      try {
        const reloaded = await api<AnalysisDetail>(`/api/analyses/${requestId}`);
        if (stillShown()) setDetail(reloaded);
      } catch {
        /* keep the last good detail */
      }
    } finally {
      if (stillShown()) setPending(false);
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
      {error ? (
        <p className="error" role="alert" data-testid="action-error">
          {error}
        </p>
      ) : null}
      <h2>Submitted text</h2>
      {limits ? <p className="meta" data-testid="content-protection-mode">
        <strong>{!limits.contentProtectionEnabled ? 'Content protection disabled'
          : limits.personProtectionEnabled ? 'Content protection enabled: names, emails and phones'
          : 'Contact protection only: emails and phones. Names are not protected.'}</strong>
      </p> : null}
      <pre data-testid="source-text"><PiiText text={detail.sourceText} /></pre>
      {detail.status === RunStatus.Failed ? (
        <div className="error" role="alert">
          <p><PiiText text={detail.errorMessage ?? ''} /></p>
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
            {message.role === 'assistant' && message.status === RunStatus.Completed && message.result ? (
              <ThreadAnswer result={message.result} />
            ) : (
              <p><PiiText text={message.content} /></p>
            )}
          </li>
        ))}
      </ol>
      {detail.status === RunStatus.Completed ? (
        <form onSubmit={(event) => void ask(event)}>
          <label>
            Question about this incident
            <textarea data-testid="question-input" value={question} onChange={(event) => setQuestion(event.target.value)} required />
          </label>
          <p className="meta">{limits ? `${question.trim().length}/${limits.questionMax}` : 'Loading content limits...'}</p>
          {limitsError ? <p className="error" role="alert">{limitsError}</p> : null}
          {tooLong ? <p className="error" role="alert">The question exceeds the maximum length. Shorten it before submitting.</p> : null}
          {pending ? <p className="status" role="status">{limits?.contentProtectionEnabled
            ? limits.personProtectionEnabled ? 'Protecting detected personal data and preparing the answer...'
              : 'Protecting detected emails and phones and preparing the answer...'
            : 'Asking…'}</p> : null}
          <button type="submit" disabled={pending || !limits || tooLong || question.trim().length === 0}>
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

/**
 * Shows the assistant answer once, with optional structured detail behind a disclosure.
 * @param result Validated question output from the API.
 */
function ThreadAnswer({ result }: { result: QuestionResult }) {
  return (
    <div className="thread-answer">
      <p data-testid="assistant-answer"><PiiText text={result.answer} /></p>
      <details>
        <summary>Evidence, hypotheses, and uncertainty</summary>
        <ResultView result={result} hideAnswer testId="thread-result-detail" />
      </details>
    </div>
  );
}
