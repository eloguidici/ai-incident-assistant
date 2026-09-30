/**
 * @param storedAnalysis JSON column value from an analysis row.
 * @returns The summary string when present, otherwise null.
 */
export function readSummary(storedAnalysis: unknown): string | null {
  if (!storedAnalysis || typeof storedAnalysis !== 'object' || !('summary' in storedAnalysis)) return null;
  const summary = (storedAnalysis as { summary?: unknown }).summary;
  return typeof summary === 'string' ? summary : null;
}

/**
 * @param storedAnalysis JSON column value from an analysis row.
 * @returns The suggested severity string when present, otherwise null.
 */
export function readSeverity(storedAnalysis: unknown): string | null {
  if (!storedAnalysis || typeof storedAnalysis !== 'object' || !('suggestedSeverity' in storedAnalysis)) return null;
  const severity = (storedAnalysis as { suggestedSeverity?: unknown }).suggestedSeverity;
  return typeof severity === 'string' ? severity : null;
}
