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

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_PATTERN = /(?:\+\d{1,3}[\s.-]*)?(?:\(\d{2,4}\)[\s.-]*)?\d{3}[\s.-]\d{3}[\s.-]\d{4}/g;
const OMITTED_QUOTE_UNCERTAINTY = 'Citations that were not copied from the incident were omitted.';
const OMITTED_QUOTE_MISSING = 'Which statements are copied verbatim from the incident.';
const CAUSE_FREE_SUMMARY = 'The incident records observations without a confirmed cause.';
const CAUSAL_MARKERS = ['attributed to', 'triggered by', 'caused by', 'due to', 'led to', 'rules out', 'confirms'];

type PrivacyRange = { start: number; end: number };

/**
 * Locates opaque privacy labels so a quote cannot count when it slices one.
 * @param incidentText Protected incident text.
 * @returns Half-open ranges of complete labels.
 */
function privacyRangesOf(incidentText: string): PrivacyRange[] {
  return Array.from(incidentText.matchAll(/\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]/g),
    (match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));
}

/**
 * Checks that a quote is an exact slice of the incident and does not cut a privacy label.
 * @param quote Candidate evidence quote.
 * @param incidentText Protected incident text.
 * @param privacyRanges Ranges from {@link privacyRangesOf}.
 * @returns True when the quote occurs outside those ranges.
 */
function quoteAppears(quote: string, incidentText: string, privacyRanges: PrivacyRange[]): boolean {
  let occurrence = incidentText.indexOf(quote);
  while (occurrence >= 0 && privacyRanges.some((range) => {
    const end = occurrence + quote.length;
    return (range.start < occurrence && occurrence < range.end) || (range.start < end && end < range.end);
  })) {
    occurrence = incidentText.indexOf(quote, occurrence + 1);
  }
  return occurrence >= 0;
}

/**
 * Rejects an email or phone number that the incident does not already contain.
 * Privacy labels stay allowed; this does not restore the text they replaced.
 * @param texts Narrative fields of a question answer.
 * @param incidentText Protected incident text.
 * @throws OutputValidationError when a contact value is absent from the incident.
 */
function assertContactsStayInIncident(texts: string[], incidentText: string): void {
  const known = new Set([
    ...(incidentText.match(EMAIL_PATTERN) ?? []),
    ...(incidentText.match(PHONE_PATTERN) ?? []),
  ].map((contact) => contact.toLowerCase()));
  for (const text of texts) {
    for (const contact of [...(text.match(EMAIL_PATTERN) ?? []), ...(text.match(PHONE_PATTERN) ?? [])]) {
      if (!known.has(contact.toLowerCase())) {
        throw new OutputValidationError('The original contact details are not available.');
      }
    }
  }
}

/**
 * Rejects non-exact quotes, partial privacy tokens, foreign URLs and impossible assistant actions.
 * An empty evidence list is accepted only with uncertainty and missing information.
 * @throws OutputValidationError when the output is not grounded.
 */
function assertGrounded(analysis: AnalysisResult, incidentText: string): void {
  const privacyRanges = privacyRangesOf(incidentText);
  for (const evidenceItem of analysis.evidence) {
    if (!quoteAppears(evidenceItem.quote, incidentText, privacyRanges)) {
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
 * Splits prose into sentences. A field without terminal punctuation stays one sentence.
 * @param text Narrative field.
 * @returns Trimmed sentences, or an empty list when the field is blank.
 */
function sentencesOf(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

/**
 * Detects a causal phrase the incident itself does not contain.
 * @param sentence Candidate sentence.
 * @param incidentText Protected incident text.
 * @returns True when the sentence asserts a cause the incident does not state.
 */
function statesUnsupportedCause(sentence: string, incidentText: string): boolean {
  const sentenceFold = sentence.toLowerCase();
  const incidentFold = incidentText.toLowerCase();
  return CAUSAL_MARKERS.some((marker) => sentenceFold.includes(marker) && !incidentFold.includes(marker));
}

/**
 * Removes sentences that assert a cause the incident does not state.
 * @param text Narrative field.
 * @param incidentText Protected incident text.
 * @param moved Sentences removed from the field. The caller appends them to uncertainty.
 * @returns The field without those sentences.
 */
function withoutUnsupportedCauses(text: string, incidentText: string, moved: string[]): string {
  const kept: string[] = [];
  for (const sentence of sentencesOf(text)) {
    if (statesUnsupportedCause(sentence, incidentText)) moved.push(sentence);
    else kept.push(sentence);
  }
  return kept.join(' ');
}

/**
 * Moves unsupported causal sentences from the summary, the answer and hypotheses into uncertainty.
 * A cause phrase that already appears in the incident stays. An emptied summary or answer gets a short observation.
 * @param result Schema-valid analysis or question.
 * @param incidentText Protected incident text.
 * @returns The same result with unsupported causes recorded as uncertainty.
 */
function demoteUnsupportedCauses<T extends AnalysisResult>(result: T, incidentText: string): T {
  const moved: string[] = [];
  const summary = withoutUnsupportedCauses(result.summary, incidentText, moved);
  const hypotheses = result.hypotheses.flatMap((hypothesis) => {
    const statement = withoutUnsupportedCauses(hypothesis.statement, incidentText, moved);
    return statement.length > 0 ? [{ ...hypothesis, statement }] : [];
  });
  const answer = 'answer' in result && typeof result.answer === 'string'
    ? withoutUnsupportedCauses(result.answer, incidentText, moved)
    : undefined;
  let uncertainty = result.uncertainty.trim();
  if (moved.length > 0) uncertainty = [uncertainty, ...moved].filter((part) => part.length > 0).join(' ');
  if (uncertainty.length > 1000) uncertainty = uncertainty.slice(0, 1000).trim();
  const missingInformation = moved.length > 0 && result.evidence.length === 0 && result.missingInformation.length === 0
    ? ['What the incident states as the cause.']
    : result.missingInformation;
  const next = {
    ...result,
    summary: summary.length > 0 ? summary : CAUSE_FREE_SUMMARY,
    hypotheses,
    missingInformation,
    uncertainty,
  };
  return answer === undefined ? next : { ...next, answer: answer.length > 0 ? answer : CAUSE_FREE_SUMMARY };
}

/**
 * Drops citations that are not exact copies and records that omission when the model left no caveat.
 * @param result Schema-valid analysis or question.
 * @param incidentText Protected incident text.
 * @returns The same result with only grounded quotes.
 */
function withoutUngroundedQuotes<T extends AnalysisResult>(result: T, incidentText: string): T {
  const privacyRanges = privacyRangesOf(incidentText);
  const evidence = result.evidence.filter((evidenceItem) => quoteAppears(evidenceItem.quote, incidentText, privacyRanges));
  const droppedQuote = evidence.length < result.evidence.length;
  return {
    ...result,
    evidence,
    uncertainty: droppedQuote && result.uncertainty.trim().length === 0 ? OMITTED_QUOTE_UNCERTAINTY : result.uncertainty,
    missingInformation: droppedQuote && result.missingInformation.length === 0
      ? [OMITTED_QUOTE_MISSING]
      : result.missingInformation,
  };
}

/**
 * Accepts an analysis when it matches the schema. Quotes that are not exact copies are removed.
 * @param rawModelText Provider JSON.
 * @param incidentText Protected incident text.
 * @returns The analysis with only grounded quotes.
 * @throws OutputValidationError when the schema, URLs, actions or an empty caveat fail.
 */
export function validateAnalysis(rawModelText: string, incidentText: string): AnalysisResult {
  const analysisOutput = analysisResultSchema.safeParse(parseModelJson(rawModelText));
  if (!analysisOutput.success) throw new OutputValidationError('The output does not match the analysis schema.');
  const analysis = demoteUnsupportedCauses(withoutUngroundedQuotes(analysisOutput.data, incidentText), incidentText);
  assertGrounded(analysis, incidentText);
  return analysis;
}

/**
 * Accepts a question about the incident even when some citations are paraphrased.
 * Quotes that are not exact copies are removed. Invented emails and phone numbers are rejected.
 * @param rawModelText Provider JSON.
 * @param incidentText Protected incident text.
 * @returns The question answer with only grounded quotes.
 * @throws OutputValidationError when the schema, URLs, actions or contact values fail. A failed question does not replace a completed analysis.
 */
export function validateQuestion(rawModelText: string, incidentText: string): QuestionResult {
  const questionOutput = questionResultSchema.safeParse(parseModelJson(rawModelText));
  if (!questionOutput.success) throw new OutputValidationError('The output does not match the question schema.');
  const question = demoteUnsupportedCauses(withoutUngroundedQuotes(questionOutput.data, incidentText), incidentText);
  assertContactsStayInIncident([
    question.answer,
    question.summary,
    question.uncertainty,
    ...question.missingInformation,
    ...question.evidence.map((evidenceItem) => evidenceItem.note),
    ...question.hypotheses.map((hypothesis) => hypothesis.statement),
  ], incidentText);
  assertGrounded(question, incidentText);
  return question;
}
