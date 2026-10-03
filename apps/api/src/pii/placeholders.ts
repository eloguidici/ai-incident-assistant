import { OutputValidationError } from '../ai/validate';

/** Truncates display/context text without cutting an opaque PII token in half. @param text Protected text. @param limit Maximum characters. @returns Prefix, possibly shorter when a token crosses the boundary. */
export function truncateProtectedText(text: string, limit: number): string {
  let end = limit;
  for (const match of text.matchAll(/\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]/g)) {
    if (match.index < end && match.index + match[0].length > end) { end = match.index; break; }
  }
  return text.slice(0, end);
}
/** Rejects malformed privacy labels and labels absent from the protected context. @param output Serialized protected result. @param context Source/question/history actually available to the model. @throws OutputValidationError on a malformed, fabricated or foreign label. */
export function assertKnownPrivacyLabels(output: string, context: string): void {
  const labels = /\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]/g;
  if (/\[(?:PERSON|EMAIL_ADDRESS|PHONE_NUMBER)(?![A-Za-z])/.test(output.replace(labels, ''))) {
    throw new OutputValidationError('The output includes a malformed privacy label.');
  }
  const known = new Set(context.match(labels) ?? []);
  for (const label of output.match(labels) ?? []) {
    if (!known.has(label)) throw new OutputValidationError('The output includes an unknown privacy label.');
  }
}
