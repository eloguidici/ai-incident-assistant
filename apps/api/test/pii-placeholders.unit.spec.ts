import { assertKnownPrivacyLabels, privacyLabelsIntroduced, truncateProtectedText } from '../src/pii/placeholders';
import { OutputValidationError, validateAnalysis } from '../src/ai/validate';
import type { AnalysisResult } from '../src/ai/contracts';
import { selectContext } from '../src/ai/context';

const personLabel = `[PERSON_${'a'.repeat(32)}]`;
const emailLabel = `[EMAIL_ADDRESS_${'b'.repeat(32)}]`;
const phoneLabel = `[PHONE_NUMBER_${'c'.repeat(32)}]`;

describe('PII placeholder truncation and provenance contracts', () => {
  it.each([personLabel, emailLabel, phoneLabel])('never produces a partial %s at any boundary inside a label', (label) => {
    const prefix = 'Observed ';
    const text = `${prefix}${label} returned HTTP 503.`;
    for (let offset = 1; offset < label.length; offset++) {
      expect(truncateProtectedText(text, prefix.length + offset)).toBe(prefix);
    }
    expect(truncateProtectedText(text, prefix.length)).toBe(prefix);
    expect(truncateProtectedText(text, prefix.length + label.length)).toBe(prefix + label);
  });

  it('preserves a preceding complete label when a later label crosses the limit', () => {
    const prefix = `${personLabel} reported `;
    const text = `${prefix}${emailLabel} at 10:15 UTC.`;
    expect(truncateProtectedText(text, prefix.length + 5)).toBe(prefix);
  });

  it('keeps complete history labels and drops a token crossing the 1000-character message limit', () => {
    const crossing = 'x'.repeat(980) + emailLabel;
    const complete = phoneLabel + 'x'.repeat(980);
    const context = selectContext('HTTP 503.', [{ role: 'user', content: crossing }, { role: 'assistant', content: complete }], 'Why?', 5_000);
    expect(context.rejected).toBe(false);
    expect(context.history[0].content).toBe('x'.repeat(980));
    expect(context.history[1].content).toContain(phoneLabel);
    expect(context.history[1].content.length).toBe(1000);
  });

  it('preserves technical brackets and ordinary text and handles empty/zero/oversized prefixes', () => {
    const text = '[HTTP_503] after [worker-2] failed.';
    expect(truncateProtectedText(text, 8)).toBe(text.slice(0, 8));
    expect(truncateProtectedText(text, 0)).toBe('');
    expect(truncateProtectedText('', 20)).toBe('');
    expect(truncateProtectedText(text, 1_000)).toBe(text);
  });

  it('accepts repeated labels only when the exact typed token exists in the available context', () => {
    expect(() => assertKnownPrivacyLabels(`${personLabel} ${personLabel} ${emailLabel}`, `Source ${personLabel}\nQuestion ${emailLabel}`)).not.toThrow();
    expect(() => assertKnownPrivacyLabels('HTTP 503 at 10:15 UTC.', 'Technical incident.')).not.toThrow();
  });

  it.each([personLabel, emailLabel, phoneLabel])('rejects fabricated or foreign %s without exposing an original identity', (label) => {
    expect(() => assertKnownPrivacyLabels(`Summary ${label}`, 'Payments returned HTTP 503.')).toThrow(OutputValidationError);
    expect(() => assertKnownPrivacyLabels(`Summary ${label}`, `[PERSON_${'d'.repeat(32)}]`)).toThrow(OutputValidationError);
  });

  it('keeps a label the sanitizer added and still rejects one the model already wrote', () => {
    const introduced = privacyLabelsIntroduced('{"summary":"Jane Doe reported HTTP 503."}', `{"summary":"${personLabel} reported HTTP 503."}`);
    expect(introduced).toEqual([personLabel]);
    expect(() => assertKnownPrivacyLabels(`{"summary":"${personLabel} reported HTTP 503."}`, 'Payments returned HTTP 503.', introduced)).not.toThrow();
    expect(() => assertKnownPrivacyLabels(`{"summary":"${personLabel} reported HTTP 503."}`, 'Payments returned HTTP 503.')).toThrow(OutputValidationError);
  });

  it('rejects type substitution even when an opaque identifier matches', () => {
    expect(() => assertKnownPrivacyLabels(`[EMAIL_ADDRESS_${'a'.repeat(32)}]`, personLabel)).toThrow(OutputValidationError);
  });

  it.each(['[PERSON_aaaa', `[PERSON_${'a'.repeat(32)}`, '[EMAIL_ADDRESS_bad]', '[PHONE_NUMBER_]'])('rejects malformed reserved token %s', (token) => {
    expect(() => assertKnownPrivacyLabels(token, personLabel)).toThrow(OutputValidationError);
  });

  it.each(['[PERSON', '[EMAIL_ADDRESS', '[PHONE_NUMBER', '[PERSON\n', '[EMAIL_ADDRESS\n', '[PHONE_NUMBER\n'])('rejects malformed tokens in serialized fields: %s', (token) => {
    expect(() => assertKnownPrivacyLabels(JSON.stringify({ summary: token }), personLabel)).toThrow(OutputValidationError);
  });

  it.each([personLabel, emailLabel, phoneLabel])('drops evidence that cuts %s at either boundary', (label) => {
    const source = `${label} reported HTTP 503.`;
    const candidate: AnalysisResult = { summary: 'Reported symptom.', category: 'availability', suggestedSeverity: 'medium',
      evidence: [], hypotheses: [], missingInformation: ['Metrics.'], uncertainty: 'Cause unknown.' };
    for (const quote of [label.slice(0, 12), label.slice(4), `${label.slice(4)} reported HTTP 503.`]) {
      const validated = validateAnalysis(JSON.stringify({ ...candidate, evidence: [{ quote, note: 'Reported symptom.' }] }), source);
      expect(validated.summary).toBe('Reported symptom.');
      expect(validated.evidence).toEqual([]);
    }
    expect(validateAnalysis(JSON.stringify({ ...candidate, evidence: [{ quote: 'HTTP 503', note: 'Reported symptom.' }] }), source).evidence[0].quote).toBe('HTTP 503');
  });

  it('grounds quotes on complete protected tokens rather than synthetic original identities', () => {
    const protectedSource = `${personLabel} reported HTTP 503.`;
    const result: AnalysisResult = { summary: 'Reported payments symptom.', category: 'availability', suggestedSeverity: 'high',
      evidence: [{ quote: protectedSource, note: 'Reported symptom.' }], hypotheses: [], missingInformation: ['Metrics.'], uncertainty: 'Cause unknown.' };
    expect(validateAnalysis(JSON.stringify(result), protectedSource).evidence[0].quote).toBe(protectedSource);
    const restored = validateAnalysis(JSON.stringify({ ...result, evidence: [{ quote: 'Alicia Exampleperson reported HTTP 503.', note: 'Original identity.' }] }), protectedSource);
    expect(restored.summary).toBe(result.summary);
    expect(restored.evidence).toEqual([]);
    const foreign = validateAnalysis(JSON.stringify({ ...result, evidence: [{ quote: `[PERSON_${'d'.repeat(32)}] reported HTTP 503.`, note: 'Foreign label.' }] }), protectedSource);
    expect(foreign.evidence).toEqual([]);
    expect(foreign.summary).not.toContain('Alicia');
  });

  it('accepts a complete ordinary occurrence even when the same text appears inside a privacy token', () => {
    const quote = 'a'.repeat(8);
    const source = `${personLabel} reported identifier ${quote}.`;
    const result: AnalysisResult = { summary: 'Reported identifier.', category: 'availability', suggestedSeverity: 'low',
      evidence: [{ quote, note: 'Reported identifier.' }], hypotheses: [], missingInformation: ['Metrics.'], uncertainty: 'Cause unknown.' };
    expect(validateAnalysis(JSON.stringify(result), source).evidence[0].quote).toBe(quote);
    expect(() => assertKnownPrivacyLabels('[HTTP_503] after [worker-2] failed.', source)).not.toThrow();
  });
});
