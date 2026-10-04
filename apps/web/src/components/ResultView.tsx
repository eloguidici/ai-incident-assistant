import type { AnalysisResult, QuestionResult } from '../api';
import { PiiText } from './PiiText';

/**
 * Renders a validated analysis or answer: summary, category, severity, evidence, hypotheses, missing information, and uncertainty.
 * @param result Analysis result, or a question result whose answer is shown first.
 * @returns The result article.
 */
export function ResultView({
  result,
  hideAnswer = false,
  testId = 'analysis-result',
}: {
  result: AnalysisResult | QuestionResult;
  hideAnswer?: boolean;
  testId?: string;
}) {
  const answer = 'answer' in result ? result.answer : null;
  return (
    <article className="result" data-testid={testId}>
      {answer && !hideAnswer ? (
        <section>
          <h2>Answer</h2>
          <p><PiiText text={answer} /></p>
        </section>
      ) : null}
      <section>
        <h2>Summary</h2>
        <p><PiiText text={result.summary} /></p>
        <p className="pills">
          <span className="pill">Category: <PiiText text={result.category} /></span>
          <span className={`pill pill--${result.suggestedSeverity}`}>Suggested severity: <PiiText text={result.suggestedSeverity} /></span>
        </p>
      </section>
      <section data-testid="evidence">
        <h2>Evidence</h2>
        {result.evidence.length === 0 ? <p>There are no quotes grounded in the text.</p> : null}
        <ul>
          {result.evidence.map((evidenceItem, index) => (
            <li key={`${index}-${evidenceItem.quote}`}>
              <blockquote><PiiText text={evidenceItem.quote} /></blockquote>
              <p><PiiText text={evidenceItem.note} /></p>
            </li>
          ))}
        </ul>
      </section>
      <section data-testid="hypotheses">
        <h2>Hypotheses</h2>
        {result.hypotheses.length === 0 ? <p>No hypotheses.</p> : null}
        <ul>
          {result.hypotheses.map((hypothesis, index) => (
            <li key={`${index}-${hypothesis.statement}`}>
              <PiiText text={hypothesis.statement} /> <span className={`pill pill--${hypothesis.confidence}`}>Confidence <PiiText text={hypothesis.confidence} />.</span>
            </li>
          ))}
        </ul>
      </section>
      <section data-testid="missing">
        <h2>Missing information</h2>
        {result.missingInformation.length === 0 ? <p>No missing information was recorded.</p> : null}
        <ul>
          {result.missingInformation.map((missingFact, index) => (
            <li key={`${index}-${missingFact}`}><PiiText text={missingFact} /></li>
          ))}
        </ul>
      </section>
      <section data-testid="uncertainty">
        <h2>Uncertainty</h2>
        <p><PiiText text={result.uncertainty || 'No uncertainty note.'} /></p>
      </section>
    </article>
  );
}
