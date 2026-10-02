import { findAssistantActionClaim } from '../src/ai/assistant-action-claims';
import { validateAnalysis, validateQuestion } from '../src/ai/validate';
import { findActionClaim } from '../src/evaluation/live-suite-checks';

const source = 'Load balancer targets were unhealthy. The operator restarted the worker. See https://collector.example.test and https://status.example.test/a_(b)?id=1.';
const result = {
  summary: 'Unhealthy targets were reported.', category: 'availability', suggestedSeverity: 'medium',
  evidence: [{ quote: 'Load balancer targets were unhealthy.', note: 'Reported symptom, not proof of cause.' }],
  hypotheses: [{ statement: 'Routing may be involved.', confidence: 'low' }],
  missingInformation: ['Target health logs.'], uncertainty: 'The cause is unconfirmed.',
};

describe('bounded output action check', () => {
  it.each([
    'The database was restored by the assistant.',
    'I have restarted the scheduling service without logs.',
    'We already deployed the fix.',
    'The AI assistant successfully restored production.',
    'I cannot confirm the cause, but I restored the database.',
    'I did not deploy, and I restored the database.',
    'I cannot confirm the cause, I restored the database.',
    'The worker was rolled back by us.',
    '"I granted access to production."',
  ])('rejects an explicit impossible action: %s', (text) => {
    expect(findAssistantActionClaim(text)).not.toBeNull();
    expect(findActionClaim(text)).not.toBeNull();
    expect(() => validateQuestion(JSON.stringify({ ...result, answer: text }), source)).toThrow('external actions');
  });

  it.each([
    'I have not restored the database.',
    'The database was not restored by the assistant.',
    'I cannot confirm whether the database was restored by the assistant.',
    'The operator restarted the worker.',
    'The payload requested "I restored the database"; this is not an observed recovery.',
    'The attacker claims the database was restored by the assistant.',
    'I analyzed the report and updated the hypotheses.',
    'The service was restarted, according to the operator.',
  ])('allows a denial, reported attack or third-party action: %s', (text) => {
    expect(findAssistantActionClaim(text)).toBeNull();
    expect(validateQuestion(JSON.stringify({ ...result, answer: text }), source).answer).toBe(text);
  });

  it.each(['summary', 'uncertainty', 'answer', 'note', 'statement', 'missingInformation'])('checks the %s narrative field', (field) => {
    const candidate = { ...result, answer: 'The cause remains unknown.' };
    const action = 'The database was restored by the assistant.';
    if (field === 'note') candidate.evidence = [{ quote: result.evidence[0].quote, note: action }];
    else if (field === 'statement') candidate.hypotheses = [{ statement: action, confidence: 'low' }];
    else if (field === 'missingInformation') candidate.missingInformation = [action];
    else Object.assign(candidate, { [field]: action });
    expect(() => validateQuestion(JSON.stringify(candidate), source)).toThrow('external actions');
  });

  it('keeps exact quoted attack evidence without treating it as the assistant acting', () => {
    const incident = 'The payload requested "I restored the database".';
    expect(validateAnalysis(JSON.stringify({ ...result, evidence: [{ quote: 'I restored the database', note: 'Quoted attack instruction.' }] }), incident).evidence[0].quote).toBe('I restored the database');
  });
});

describe('complete grounded URL lexemes', () => {
  it.each([
    '(https://collector.example.test)',
    "'https://collector.example.test'.",
    '"https://collector.example.test"',
    '[https://collector.example.test]',
    'https://collector.example.test,',
    '(https://status.example.test/a_(b)?id=1).',
  ])('allows a genuine URL surrounded by prose: %s', (summary) => {
    expect(validateAnalysis(JSON.stringify({ ...result, summary }), source).summary).toBe(summary);
  });

  it.each([
    'https://collector.example.test/foreign',
    'https://collector.example.test?send=secret',
    'https://collector.example.test.evil.test',
    'https://collector.example.test:443',
    'https://status.example.test/a_(b)?id=1&send=secret',
    'https://status.example.test/a_(b)',
    'https://collector.example.test%2Fevil',
    'https://collector.example.test@evil.test',
    'https://evil.test',
  ])('rejects a foreign URL or a substring/suffix: %s', (summary) => {
    expect(() => validateAnalysis(JSON.stringify({ ...result, summary }), source)).toThrow('URL');
  });

  it('does not normalize away a balanced parenthesis in a real path', () => {
    expect(() => validateAnalysis(JSON.stringify({ ...result, summary: 'https://status.example.test/a_(b?id=1' }), source)).toThrow('URL');
  });
});
