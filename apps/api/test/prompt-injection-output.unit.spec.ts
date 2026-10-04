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

describe('questions about the incident', () => {
  const incident = 'On 2026-10-02 at 10:15 UTC the payments API returned HTTP 503 for twelve minutes. Load balancer targets were unhealthy. Contact [EMAIL_ADDRESS_ab235a3631c7decc429cce9519489248].';
  const question = {
    summary: 'The payments API returned HTTP 503.',
    category: 'availability',
    suggestedSeverity: 'medium',
    hypotheses: [{ statement: 'The unhealthy targets may be related.', confidence: 'low' }],
    missingInformation: ['Backend logs.'],
    uncertainty: 'The cause is unconfirmed.',
  };

  it('keeps the answer and drops a quote that is not in the incident', () => {
    const validated = validateQuestion(JSON.stringify({
      ...question,
      answer: 'The payments API returned HTTP 503 for twelve minutes. The cause is unconfirmed.',
      evidence: [
        { quote: 'el servicio no respondió', note: 'Paraphrase that is not in the incident.' },
        { quote: 'returned HTTP 503', note: 'Observed status.' },
      ],
    }), incident);
    expect(validated.answer).toContain('HTTP 503');
    expect(validated.evidence.map((evidenceItem) => evidenceItem.quote)).toEqual(['returned HTTP 503']);
  });

  it('still answers when every quote was paraphrased', () => {
    const validated = validateQuestion(JSON.stringify({
      ...question,
      answer: 'La API de pagos devolvió HTTP 503 durante doce minutos.',
      evidence: [{ quote: 'el servicio no respondió', note: 'Paraphrase.' }],
      uncertainty: '',
      missingInformation: [],
    }), incident);
    expect(validated.answer).toContain('HTTP 503');
    expect(validated.evidence).toEqual([]);
    expect(validated.uncertainty).toContain('not copied from the incident');
    expect(validated.missingInformation.length).toBeGreaterThan(0);
  });

  it('keeps a new analysis and drops a quote that is not in the incident', () => {
    const validated = validateAnalysis(JSON.stringify({
      ...question,
      evidence: [{ quote: 'el servicio no respondió', note: 'Paraphrase.' }],
      uncertainty: '',
      missingInformation: [],
    }), incident);
    expect(validated.summary).toContain('HTTP 503');
    expect(validated.evidence).toEqual([]);
    expect(validated.uncertainty).toContain('not copied from the incident');
  });

  it('rejects an email or phone that is not in the incident', () => {
    expect(() => validateQuestion(JSON.stringify({
      ...question,
      answer: 'The analyst email is jane.doe@example.com.',
      evidence: [],
    }), incident)).toThrow('original contact details');
    expect(() => validateQuestion(JSON.stringify({
      ...question,
      answer: 'Call +1 415 555 0199 for the original number.',
      evidence: [],
    }), incident)).toThrow('original contact details');
  });

  it('allows the protected label without restoring it', () => {
    const validated = validateQuestion(JSON.stringify({
      ...question,
      answer: 'The original email is not available. The incident shows [EMAIL_ADDRESS_ab235a3631c7decc429cce9519489248].',
      evidence: [{ quote: 'Contact [EMAIL_ADDRESS_ab235a3631c7decc429cce9519489248].', note: 'Protected contact label.' }],
    }), incident);
    expect(validated.answer).toContain('[EMAIL_ADDRESS_ab235a3631c7decc429cce9519489248]');
    expect(validated.evidence).toHaveLength(1);
  });

  it('moves an unsupported cause into uncertainty and keeps the observation', () => {
    const validated = validateQuestion(JSON.stringify({
      ...question,
      answer: 'The payments API returned HTTP 503 for twelve minutes. The outage was attributed to unhealthy load balancer targets.',
      summary: 'Targets were unhealthy. The failure was triggered by a deployment.',
      hypotheses: [{ statement: 'A deployment caused by a bad release may explain it.', confidence: 'low' }],
      evidence: [{ quote: 'returned HTTP 503', note: 'Observed status.' }],
    }), incident);
    expect(validated.answer).toBe('The payments API returned HTTP 503 for twelve minutes.');
    expect(validated.answer.toLowerCase()).not.toContain('attributed to');
    expect(validated.summary).toBe('Targets were unhealthy.');
    expect(validated.hypotheses).toEqual([]);
    expect(validated.uncertainty.toLowerCase()).toContain('attributed to');
    expect(validated.uncertainty.toLowerCase()).toContain('triggered by');
  });

  it('keeps a cause phrase that the incident already states', () => {
    const validated = validateAnalysis(JSON.stringify({
      ...question,
      summary: 'The report says the outage was due to a blank configuration.',
      evidence: [{ quote: 'returned HTTP 503', note: 'Observed status.' }],
    }), `${incident} The outage was due to a blank configuration.`);
    expect(validated.summary).toContain('due to a blank configuration');
  });
});
