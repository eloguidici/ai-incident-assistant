import { analysisResultSchema, questionResultSchema, type AnalysisResult, type QuestionResult } from './contracts';
import { findAssistantActionClaim } from './assistant-action-claims';

/**
 * Extracts complete HTTP(S) lexemes, ignoring prose quotes/punctuation and unmatched closers.
 * Balanced parentheses in paths are preserved; paths, ports and query suffixes are not normalized.
 * @param text Source or output prose. @returns Distinct URL lexemes, without fetching them.
 */
export function urlsIn(text: string): Set<string> {
  return new Set((text.match(/https?:\/\/[^\s<>"`]+/g) ?? []).map((candidate) => {
    let url = candidate.replace(/[.,;:!'\u2019]+$/g, '');
    for (;;) {
      const closer = url.at(-1);
      const opener = closer === ')' ? '(' : closer === ']' ? '[' : closer === '}' ? '{' : undefined;
      if (!opener || url.split(closer!).length <= url.split(opener).length) break;
      url = url.slice(0, -1).replace(/[.,;:!'\u2019]+$/g, '');
    }
    return url;
  }));
}

/** Model output that is not JSON, does not match the schema, or is not grounded in the incident. */
export class OutputValidationError extends Error {
  /** @param message Reason the output was rejected. It is not shown as an analysis result. */
  constructor(message: string) {
    super(message);
  }
}

/**
 * Parses model text as JSON and strips a surrounding markdown fence when one is present.
 * @param raw Provider text.
 * @throws OutputValidationError when the text is not JSON.
 */
export function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new OutputValidationError('Model output is not JSON.');
  }
}

/**
 * Rejects non-exact quotes, partial privacy tokens, foreign URLs and impossible assistant actions.
 * An empty evidence list is accepted only with uncertainty and missing information.
 * @throws OutputValidationError when the output is not grounded.
 */
function assertGrounded(analysis: AnalysisResult, incidentText: string): void {
  const privacyRanges = Array.from(incidentText.matchAll(/\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]/g),
    (match) => ({ start: match.index, end: match.index + match[0].length }));
  for (const evidenceItem of analysis.evidence) {
    let occurrence = incidentText.indexOf(evidenceItem.quote);
    while (occurrence >= 0 && privacyRanges.some((range) => {
      const end = occurrence + evidenceItem.quote.length;
      return (range.start < occurrence && occurrence < range.end) || (range.start < end && end < range.end);
    })) {
      occurrence = incidentText.indexOf(evidenceItem.quote, occurrence + 1);
    }
    if (occurrence < 0) {
      throw new OutputValidationError('A quote does not appear in the incident.');
    }
  }
  const groundedTexts = [
    analysis.summary,
    analysis.uncertainty,
    ...analysis.missingInformation,
    ...analysis.evidence.flatMap((evidenceItem) => [evidenceItem.quote, evidenceItem.note]),
    ...analysis.hypotheses.map((hypothesis) => hypothesis.statement),
  ];
  if ('answer' in analysis && typeof analysis.answer === 'string') groundedTexts.push(analysis.answer);
  const sourceUrls = urlsIn(incidentText);
  for (const groundedText of groundedTexts) {
    for (const url of urlsIn(groundedText)) {
      if (!sourceUrls.has(url)) throw new OutputValidationError('The output includes a URL that is not in the incident.');
    }
  }
  const narrativeTexts = [analysis.summary, analysis.uncertainty, ...analysis.missingInformation,
    ...analysis.evidence.map((item) => item.note), ...analysis.hypotheses.map((item) => item.statement)];
  if ('answer' in analysis && typeof analysis.answer === 'string') narrativeTexts.push(analysis.answer);
  if (narrativeTexts.some((text) => findAssistantActionClaim(text) !== null)) {
    throw new OutputValidationError('The assistant cannot claim to have performed external actions.');
  }
  if (analysis.evidence.length === 0 && (analysis.uncertainty.trim().length === 0 || analysis.missingInformation.length === 0)) {
    throw new OutputValidationError('Without quotes, the output must state uncertainty and missing information.');
  }
}

/**
 * Accepts an analysis only when it matches the schema and is grounded in the incident.
 * @throws OutputValidationError otherwise.
 */
export function validateAnalysis(rawModelText: string, incidentText: string): AnalysisResult {
  const analysisOutput = analysisResultSchema.safeParse(parseModelJson(rawModelText));
  if (!analysisOutput.success) throw new OutputValidationError('The output does not match the analysis schema.');
  assertGrounded(analysisOutput.data, incidentText);
  return analysisOutput.data;
}

/**
 * Accepts a question answer only when it matches the schema and is grounded in the incident.
 * @throws OutputValidationError otherwise. A failed question does not replace a completed analysis.
 */
export function validateQuestion(rawModelText: string, incidentText: string): QuestionResult {
  const questionOutput = questionResultSchema.safeParse(parseModelJson(rawModelText));
  if (!questionOutput.success) throw new OutputValidationError('The output does not match the question schema.');
  assertGrounded(questionOutput.data, incidentText);
  return questionOutput.data;
}
