import type { AnalysisResult, QuestionResult } from '../api';

/**
 * Renders a validated analysis or answer: summary, category, severity, evidence, hypotheses, missing information, and uncertainty.
 * @param result Analysis result, or a question result whose answer is shown first.
 * @returns The result article.
 */
export function ResultView({ result }: { result: AnalysisResult | QuestionResult }) {
  const answer = 'answer' in result ? result.answer : null;
  return (
    <article className="result" data-testid="analysis-result">
      {answer ? (
        <section>
          <h2>Answer</h2>
          <p>{answer}</p>
        </section>
      ) : null}
      <section>
        <h2>Summary</h2>
        <p>{result.summary}</p>
        <p className="meta">
          Category: {result.category}. Suggested severity: {result.suggestedSeverity}.
        </p>
      </section>
      <section data-testid="evidence">
        <h2>Evidence</h2>
        {result.evidence.length === 0 ? <p>There are no quotes grounded in the text.</p> : null}
        <ul>
          {result.evidence.map((evidenceItem) => (
            <li key={evidenceItem.quote}>
              <blockquote>{evidenceItem.quote}</blockquote>
              <p>{evidenceItem.note}</p>
            </li>
          ))}
        </ul>
      </section>
      <section data-testid="hypotheses">
        <h2>Hypotheses</h2>
        {result.hypotheses.length === 0 ? <p>No hypotheses.</p> : null}
        <ul>
          {result.hypotheses.map((hypothesis) => (
            <li key={hypothesis.statement}>
              {hypothesis.statement} <span className="meta">Confidence {hypothesis.confidence}.</span>
            </li>
          ))}
        </ul>
      </section>
      <section data-testid="missing">
        <h2>Missing information</h2>
        {result.missingInformation.length === 0 ? <p>No missing information was recorded.</p> : null}
        <ul>
          {result.missingInformation.map((missingFact) => (
            <li key={missingFact}>{missingFact}</li>
          ))}
        </ul>
      </section>
      <section data-testid="uncertainty">
        <h2>Uncertainty</h2>
        <p>{result.uncertainty || 'No uncertainty note.'}</p>
      </section>
    </article>
  );
}
