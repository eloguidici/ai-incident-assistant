import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type AnalysisDetail } from '../api';

const MAX_SOURCE_LENGTH = 8000;

/**
 * Form to paste an incident and request an analysis. On success it opens the new analysis detail.
 * @returns The analysis form.
 */
export function NewAnalysisPage() {
  const navigate = useNavigate();
  const [sourceText, setSourceText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * Sends the incident text and navigates to the created analysis. Errors are shown in the form.
   * @param event Form submit event. The default navigation is prevented.
   */
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const createdAnalysis = await api<AnalysisDetail>('/api/analyses', {
        method: 'POST',
        body: JSON.stringify({ sourceText }),
      });
      navigate(`/history/${createdAnalysis.id}`);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'The incident could not be analyzed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <p className="eyebrow">New analysis</p>
      <h1>Paste the incident report</h1>
      <p className="lead">The text is sent to the configured model. No actions are run on other systems.</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Incident text
          <textarea
            data-testid="source-input"
            value={sourceText}
            maxLength={MAX_SOURCE_LENGTH}
            rows={12}
            onChange={(event) => setSourceText(event.target.value)}
            required
          />
        </label>
        <p className="meta">
          {sourceText.trim().length}/{MAX_SOURCE_LENGTH}
        </p>
        {error ? (
          <p className="error" role="alert" data-testid="form-error">
            {error}
          </p>
        ) : null}
        {pending ? <p className="status">Analyzing… this can take a few seconds.</p> : null}
        <button type="submit" disabled={pending || sourceText.trim().length === 0}>
          {pending ? 'Analyzing…' : 'Analyze'}
        </button>
      </form>
    </section>
  );
}
