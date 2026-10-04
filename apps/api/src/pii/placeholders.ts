import { OutputValidationError } from '../ai/validate';

/** Truncates display/context text without cutting an opaque PII token in half. @param text Protected text. @param limit Maximum characters. @returns Prefix, possibly shorter when a token crosses the boundary. */
export function truncateProtectedText(text: string, limit: number): string {
  let end = limit;
  for (const match of text.matchAll(/\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]/g)) {
    if (match.index < end && match.index + match[0].length > end) { end = match.index; break; }
  }
  return text.slice(0, end);
}
const privacyLabelPattern = /\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]/g;

/**
 * Lists privacy labels that appear only after narrative sanitizing.
 * A label the model already wrote is not included, so a fabricated token can still be rejected.
 * @param before Serialized model result before sanitizing.
 * @param after Serialized result after sanitizing.
 * @returns Labels introduced by the sanitizer. The original text they replaced is not returned.
 */
export function privacyLabelsIntroduced(before: string, after: string): string[] {
  const prior = new Set(before.match(privacyLabelPattern) ?? []);
  return [...new Set(after.match(privacyLabelPattern) ?? [])].filter((label) => !prior.has(label));
}

/**
 * Rejects malformed privacy labels and labels the model wrote that are absent from the protected context.
 * Labels the sanitizer just added are accepted when passed in `introduced`. They replace detected text and do not restore it.
 * @param output Serialized protected result.
 * @param context Source, question and history available to the model.
 * @param introduced Labels from {@link privacyLabelsIntroduced}.
 * @throws OutputValidationError on a malformed label or a label the model fabricated.
 */
export function assertKnownPrivacyLabels(output: string, context: string, introduced: readonly string[] = []): void {
  const labels = /\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]/g;
  if (/\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)(?![A-Za-z])/.test(output.replace(labels, ''))) {
    throw new OutputValidationError('The output includes a malformed privacy label.');
  }
  const known = new Set([...(context.match(labels) ?? []), ...introduced]);
  for (const label of output.match(labels) ?? []) {
    if (!known.has(label)) throw new OutputValidationError('The output includes an unknown privacy label.');
  }
}
