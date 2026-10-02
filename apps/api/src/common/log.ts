import { SECURITY_DETECTOR_VERSION, SECURITY_INPUT_KINDS, SECURITY_RULE_IDS } from './constants/security-signal';

const SECURITY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  securityDetector: [SECURITY_DETECTOR_VERSION],
  securityRule: SECURITY_RULE_IDS,
  securityInput: SECURITY_INPUT_KINDS,
};

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
  'note',
  ...Object.keys(SECURITY_FIELDS),
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
    if (Object.hasOwn(SECURITY_FIELDS, fieldName) &&
      (typeof fieldValue !== 'string' || !SECURITY_FIELDS[fieldName].includes(fieldValue))) continue;
    if (typeof fieldValue === 'string' || typeof fieldValue === 'number' || typeof fieldValue === 'boolean' || fieldValue === null) {
      redactedFields[fieldName] = fieldValue;
    }
  }
  return redactedFields;
}

/**
 * Writes one JSON log line after redaction.
 * @param level Severity label printed with the line.
 * @param fields Same input as {@link redactFields}.
 */
export function logSafe(fields: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info'): void {
  const payload = { level, ts: new Date().toISOString(), ...redactFields(fields) };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
