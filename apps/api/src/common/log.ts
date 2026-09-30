const ALLOWED = new Set([
  'msg',
  'method',
  'path',
  'status',
  'correlationId',
  'latencyMs',
  'provider',
  'model',
  'promptVersion',
  'attempts',
  'errorCode',
  'analysisId',
  'userId',
  'kind',
  'deleted',
]);

/**
 * Keeps only the allowlisted log fields.
 * @param fields Candidate fields. Secrets, source text, and unknown keys are dropped.
 * @returns A record safe to print.
 */
export function redactFields(fields: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const redactedFields: Record<string, string | number | boolean | null> = {};
  for (const [fieldName, fieldValue] of Object.entries(fields)) {
    if (!ALLOWED.has(fieldName)) continue;
    if (typeof fieldValue === 'string' || typeof fieldValue === 'number' || typeof fieldValue === 'boolean' || fieldValue === null) {
      redactedFields[fieldName] = fieldValue;
    }
  }
  return redactedFields;
}

/**
 * Writes one JSON log line at info level after redaction.
 * @param fields Same input as {@link redactFields}.
 */
export function logSafe(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: 'info', ...redactFields(fields) }));
}
