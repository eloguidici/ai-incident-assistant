/** Extra milliseconds beyond the model deadline before a processing row is marked interrupted. */
export const StuckRecoveryGraceMs = 5000;

/** Correlation id used for retention purge audit events. */
export const RetentionCorrelationId = 'retention';

/**
 * Cutoff timestamp: rows still in `processing` with activity before this time are considered stuck.
 * @param deadlineMs Total LLM orchestration deadline from configuration.
 * @param now Current time in milliseconds.
 */
export function stuckRecoveryCutoff(deadlineMs: number, now = Date.now()): Date {
  return new Date(now - deadlineMs - StuckRecoveryGraceMs);
}

/**
 * Interval between stuck-run recovery sweeps. Chosen as roughly half the orchestration window plus grace, bounded for safety.
 * @param deadlineMs Total LLM orchestration deadline from configuration.
 */
export function stuckRecoveryIntervalMs(deadlineMs: number): number {
  const window = deadlineMs + StuckRecoveryGraceMs;
  return Math.max(15_000, Math.min(60_000, Math.floor(window / 2)));
}
