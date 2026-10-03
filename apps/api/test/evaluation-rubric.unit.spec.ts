import type { AnalysisResult } from '../src/ai/contracts';
import { OutputValidationError, validateAnalysis } from '../src/ai/validate';
import type { EvalFixture } from '../src/evaluation/fixtures';
import { scoreAnalysis } from '../src/evaluation/rubric';

const sourceUrl = 'https://status.example.test/incidents/123?view=full';

/**
 * Builds a synthetic fixture and schema-valid candidate without invoking a provider.
 * @param reference Reference prose appended to the incident.
 * @param summary Candidate summary to evaluate.
 * @returns Fixture and candidate sharing an exact incident quote.
 */
function candidateFor(reference: string, summary: string): { fixture: EvalFixture; analysis: AnalysisResult } {
  return {
    fixture: { id: 'url-regression', kind: 'clear', source: `HTTP 503. Reference: ${reference}` },
    analysis: {
      summary,
      category: 'availability',
      suggestedSeverity: 'high',
      evidence: [{ quote: 'HTTP 503', note: 'Observed failure.' }],
      hypotheses: [{ statement: 'Root cause needs investigation.', confidence: 'low' }],
      missingInformation: ['Recovery timeline'],
      uncertainty: 'Root cause is not confirmed.',
    },
  };
}

/**
 * Reads the URL check independently of the remaining rubric dimensions.
 * @param fixture Synthetic incident.
 * @param analysis Candidate output.
 * @returns Whether every output HTTP(S) URL appears in the incident.
 */
function urlCheckPasses(fixture: EvalFixture, analysis: AnalysisResult): boolean | undefined {
  return scoreAnalysis(fixture, analysis).checks.find((check) => check.name === 'no-invented-url')?.pass;
}

describe('evaluation URL rubric', () => {
  it('rejects a foreign URL when the source contains another URL', () => {
    const { fixture, analysis } = candidateFor(sourceUrl, 'See https://foreign.example.test/report');
    expect(urlCheckPasses(fixture, analysis)).toBe(false);
    expect(scoreAnalysis(fixture, analysis).pass).toBe(false);
  });

  it.each([
    { name: 'exact URL', source: sourceUrl, output: sourceUrl, pass: true },
    { name: 'parenthesized prose', source: `(${sourceUrl}).`, output: sourceUrl, pass: true },
    { name: 'quoted prose', source: `"${sourceUrl}"`, output: `'${sourceUrl}'.`, pass: true },
    { name: 'curly closing quote', source: `${sourceUrl}\u2019.`, output: sourceUrl, pass: true },
    { name: 'balanced path parentheses', source: 'https://example.test/a_(b)', output: '(https://example.test/a_(b)).', pass: true },
    { name: 'multiple authorized URLs', source: `${sourceUrl} https://example.test/second`, output: `${sourceUrl} https://example.test/second`, pass: true },
    { name: 'no URL on either side', source: 'No link supplied.', output: 'HTTP failure needs investigation.', pass: true },
    { name: 'no output URL', source: sourceUrl, output: 'HTTP failure needs investigation.', pass: true },
    { name: 'invented URL without source URL', source: 'HTTP failure only.', output: sourceUrl, pass: false },
    { name: 'different path', source: sourceUrl, output: 'https://status.example.test/incidents/456?view=full', pass: false },
    { name: 'additional query', source: sourceUrl, output: `${sourceUrl}&token=synthetic`, pass: false },
    { name: 'shortened URL', source: sourceUrl, output: 'https://status.example.test/incidents/123', pass: false },
    { name: 'different port', source: sourceUrl, output: 'https://status.example.test:8443/incidents/123?view=full', pass: false },
    { name: 'different scheme', source: sourceUrl, output: 'http://status.example.test/incidents/123?view=full', pass: false },
    { name: 'foreign domain suffix', source: 'https://status.example.test', output: 'https://status.example.test.foreign.test', pass: false },
    { name: 'URL substring', source: 'https://status.example.test/path-long', output: 'https://status.example.test/path', pass: false },
    { name: 'one invented among authorized URLs', source: sourceUrl, output: `${sourceUrl} https://foreign.example.test/report`, pass: false },
  ])('agrees with runtime validation for $name', ({ source, output, pass }) => {
    const { fixture, analysis } = candidateFor(source, `Report: ${output}`);
    expect(urlCheckPasses(fixture, analysis)).toBe(pass);
    if (pass) expect(validateAnalysis(JSON.stringify(analysis), fixture.source)).toEqual(analysis);
    else expect(() => validateAnalysis(JSON.stringify(analysis), fixture.source)).toThrow(OutputValidationError);
  });

  const narrativeFields: Array<[string, (analysis: AnalysisResult, url: string) => void]> = [
    ['summary', (analysis, url) => { analysis.summary = url; }],
    ['uncertainty', (analysis, url) => { analysis.uncertainty = url; }],
    ['missing information', (analysis, url) => { analysis.missingInformation = [url]; }],
    ['evidence quote', (analysis, url) => { analysis.evidence[0].quote = url; }],
    ['evidence note', (analysis, url) => { analysis.evidence[0].note = url; }],
    ['hypothesis', (analysis, url) => { analysis.hypotheses[0].statement = url; }],
  ];

  it.each(narrativeFields)('checks a foreign URL in %s', (_name, setField) => {
    const { fixture, analysis } = candidateFor(sourceUrl, 'HTTP failure.');
    setField(analysis, 'https://foreign.example.test/report');
    expect(urlCheckPasses(fixture, analysis)).toBe(false);
  });

  it.each(narrativeFields)('accepts an authorized URL in %s', (_name, setField) => {
    const { fixture, analysis } = candidateFor(sourceUrl, 'HTTP failure.');
    setField(analysis, sourceUrl);
    expect(urlCheckPasses(fixture, analysis)).toBe(true);
    expect(validateAnalysis(JSON.stringify(analysis), fixture.source)).toEqual(analysis);
  });
});
