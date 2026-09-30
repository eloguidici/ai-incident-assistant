import { analysisResultSchema, questionResultSchema, type AnalysisResult, type QuestionResult } from './contracts';

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
 * Rejects quotes and URLs that are not exact substrings of the incident.
 * An empty evidence list is accepted only with uncertainty and missing information.
 * @throws OutputValidationError when the output is not grounded.
 */
function assertGrounded(analysis: AnalysisResult, incidentText: string): void {
  for (const evidenceItem of analysis.evidence) {
    if (!incidentText.includes(evidenceItem.quote)) {
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
  for (const groundedText of groundedTexts) {
    for (const url of groundedText.match(/https?:\/\/\S+/g) ?? []) {
      if (!incidentText.includes(url)) throw new OutputValidationError('The output includes a URL that is not in the incident.');
    }
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
