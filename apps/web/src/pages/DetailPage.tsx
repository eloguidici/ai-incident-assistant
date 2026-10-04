import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, RunStatus, type AnalysisDetail, type AnalysisResult, type QuestionResult } from '../api';
import { ResultView } from '../components/ResultView';
import { PiiText, PrivacyLabelScope } from '../components/PiiText';
import { WaitStatus } from '../components/WaitStatus';
import { useContentLimits } from '../hooks/useContentLimits';

const detailTabs = [
  { id: 'incident', label: 'Incident' },
  { id: 'result', label: 'Result' },
  { id: 'questions', label: 'Questions' },
] as const;

type DetailTab = (typeof detailTabs)[number]['id'];

/**
 * Shows one analysis. Result, incident text, and questions each sit on a tab.
 * @returns The detail view, a loading message, or an error alert.
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
  const [tab, setTab] = useState<DetailTab>('result');

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    shownId.current = id;
    setError(null);
    setDetail(null);
    setPending(false);
    setQuestion('');
    setTab('result');
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

  /**
   * Moves between the three sections with the arrow keys.
   * @param event Key event from the tab list.
   */
  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    const index = detailTabs.findIndex((item) => item.id === tab);
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    const next = detailTabs[(index + direction + detailTabs.length) % detailTabs.length].id;
    setTab(next);
    document.getElementById(`detail-tab-${next}`)?.focus();
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

  if (!detail && !error) return <WaitStatus>Loading analysis…</WaitStatus>;
  if (!detail) return <p className="error" role="alert">{error}</p>;

  return (
    <PrivacyLabelScope texts={detailPrivacyTexts(detail)}>
    <section className="reading" data-privacy-scope>
      <p className="eyebrow">Detail</p>
      <h1 className={`status-title status-title--${detail.status}`}>Analysis {detail.status}</h1>
      <p className="meta meta-facts" data-testid="model-meta">
        <span>Model {detail.model ?? 'no model'}</span>
        <span>Prompt {detail.promptVersion ?? 'no version'}</span>
        <span>Kept until {keptUntilLabel(detail.expiresAt)}</span>
      </p>
      {error ? (
        <p className="error" role="alert" data-testid="action-error">
          {error}
        </p>
      ) : null}
      <div className="tabs" role="tablist" aria-label="Analysis sections" onKeyDown={moveTab}>
        {detailTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`detail-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`detail-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="detail-panel-result" aria-labelledby="detail-tab-result" hidden={tab !== 'result'}>
        {detail.status === RunStatus.Failed ? (
          <div className="error" role="alert">
            <p><PiiText text={detail.errorMessage ?? ''} /></p>
            <button type="button" onClick={() => void retry()} disabled={pending}>
              Retry
            </button>
            {pending ? <WaitStatus>Retrying the analysis…</WaitStatus> : null}
          </div>
        ) : null}
        {detail.result ? <ResultView result={detail.result} /> : null}
      </div>
      <div role="tabpanel" id="detail-panel-incident" aria-labelledby="detail-tab-incident" hidden={tab !== 'incident'}>
        <h2>Submitted text</h2>
        {detail.assistantInstructionsNoted ? (
          <p className="instruction-note" data-testid="assistant-instruction-note">
            <strong className="instruction-note__label">Prompt injection</strong>
            This submitted text contains instructions directed at the assistant. The analysis still runs. This note is not a verdict on the result.
          </p>
        ) : null}
        {limits ? <p className="meta" data-testid="content-protection-mode">
          <strong>{!limits.contentProtectionEnabled ? 'Content protection disabled'
            : limits.personProtectionEnabled ? 'Content protection enabled: names, emails and phones'
            : 'Contact protection only: emails and phones. Names are not protected.'}</strong>
        </p> : null}
        <pre data-testid="source-text"><PiiText text={detail.sourceText} /></pre>
      </div>
      <div role="tabpanel" id="detail-panel-questions" aria-labelledby="detail-tab-questions" hidden={tab !== 'questions'}>
        <h2>Conversation</h2>
        {detail.messages.length === 0 ? <p data-testid="no-messages">There are no questions yet.</p> : null}
        <ol className="thread">
          {detail.messages.map((message) => (
            <li key={message.id} className={`bubble bubble--${message.role}`} data-testid={`message-${message.status}`}>
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
            {pending ? <WaitStatus>{limits?.contentProtectionEnabled
              ? limits.personProtectionEnabled ? 'Protecting detected personal data and preparing the answer...'
                : 'Protecting detected emails and phones and preparing the answer...'
              : 'Asking…'}</WaitStatus> : null}
            <button type="submit" disabled={pending || !limits || tooLong || question.trim().length === 0}>
              Ask
            </button>
          </form>
        ) : null}
      </div>
      <p>
        <Link to="/history">Back to history</Link>
      </p>
    </section>
    </PrivacyLabelScope>
  );
}

/**
 * Formats the retention date as a full English calendar date.
 * @param expiresAt ISO timestamp stored on the analysis.
 * @returns A date such as "November 2, 2026", or a fallback when the timestamp is not a date.
 */
function keptUntilLabel(expiresAt: string): string {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return 'an unknown date';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Lists protected strings in the order the detail page renders them.
 * @param detail Loaded analysis, including its result and thread.
 * @returns Strings whose privacy tokens share one numbering. The original values are not recovered.
 */
function detailPrivacyTexts(detail: AnalysisDetail): string[] {
  return [
    ...(detail.status === RunStatus.Failed ? [detail.errorMessage ?? ''] : []),
    ...(detail.result ? resultPrivacyTexts(detail.result, false) : []),
    detail.sourceText,
    ...detail.messages.flatMap((message) => (
      message.role === 'assistant' && message.status === RunStatus.Completed && message.result
        ? resultPrivacyTexts(message.result, true)
        : [message.content]
    )),
  ];
}

/**
 * Lists one result's fields in the order {@link ResultView} renders them.
 * @param result Analysis or question result.
 * @param includeAnswer Whether the answer paragraph is rendered before the summary.
 * @returns Protected field strings. An empty uncertainty uses the same fallback as the view.
 */
function resultPrivacyTexts(result: AnalysisResult | QuestionResult, includeAnswer: boolean): string[] {
  const answer = 'answer' in result && includeAnswer ? [result.answer] : [];
  return [
    ...answer,
    result.summary,
    result.category,
    result.suggestedSeverity,
    ...result.evidence.flatMap((item) => [item.quote, item.note]),
    ...result.hypotheses.flatMap((hypothesis) => [hypothesis.statement, hypothesis.confidence]),
    ...result.missingInformation,
    result.uncertainty || 'No uncertainty note.',
  ];
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
