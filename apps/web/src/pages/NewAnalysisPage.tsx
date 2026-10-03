import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type AnalysisDetail } from '../api';
import { ApiErrorCode } from '../constants';

import { useContentLimits } from '../hooks/useContentLimits';

/**
 * Form to paste an incident and request an analysis. On success it opens the new analysis detail.
 * @returns The analysis form.
 */
export function NewAnalysisPage() {
  const navigate = useNavigate();
  const [sourceText, setSourceText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invalidOutput, setInvalidOutput] = useState(false);
  const [pending, setPending] = useState(false);
  const { limits, error: limitsError } = useContentLimits();
  const tooLong = Boolean(limits && sourceText.trim().length > limits.sourceTextMax);

  /**
   * Sends the incident text and navigates to the created analysis. Errors are shown in the form.
   * @param event Form submit event. The default navigation is prevented.
   */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!limits || tooLong || pending) return;
    setPending(true);
    setError(null);
    setInvalidOutput(false);
    try {
      const createdAnalysis = await api<AnalysisDetail>('/api/analyses', {
        method: 'POST',
        body: JSON.stringify({ sourceText }),
      });
      navigate(`/history/${createdAnalysis.id}`);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'The incident could not be analyzed.');
      setInvalidOutput(failure instanceof ApiError && failure.code === ApiErrorCode.InvalidOutput);
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <p className="eyebrow">New analysis</p>
      <h1>Paste the incident report</h1>
      <p className="lead">The text is sent to the configured model. No actions are run on other systems.</p>
      <p className="meta">Use synthetic data. Do not submit confidential information.</p>
      {limits ? <p className="meta" data-testid="content-protection-mode">
        <strong>{!limits.contentProtectionEnabled ? 'Content protection disabled'
          : limits.personProtectionEnabled ? 'Content protection enabled: names, emails and phones'
          : 'Contact protection only: emails and phones. Names are not protected.'}</strong>
      </p> : null}
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Incident text
          <textarea
            data-testid="source-input"
            value={sourceText}
            rows={12}
            onChange={(event) => setSourceText(event.target.value)}
            required
          />
        </label>
        <p className="meta">
          {limits ? `${sourceText.trim().length}/${limits.sourceTextMax}` : 'Loading content limits...'}
        </p>
        {limitsError ? <p className="error" role="alert">{limitsError}</p> : null}
        {tooLong ? <p className="error" role="alert">The incident exceeds the maximum length. Shorten it before submitting.</p> : null}
        {error ? (
          <p className="error" role="alert" data-testid="form-error">
            {error}
          </p>
        ) : null}
        {invalidOutput ? <p><Link to="/history">View failed attempts</Link></p> : null}
        {pending ? <p className="status" role="status">{limits?.contentProtectionEnabled
          ? limits.personProtectionEnabled ? 'Protecting detected personal data and analyzing...'
            : 'Protecting detected emails and phones and analyzing...'
          : 'Analyzing… this can take a few seconds.'}</p> : null}
        <button type="submit" disabled={pending || !limits || tooLong || sourceText.trim().length === 0}>
          {pending ? 'Analyzing…' : 'Analyze'}
        </button>
      </form>
    </section>
  );
}
