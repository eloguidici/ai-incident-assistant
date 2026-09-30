/**
 * Lifecycle of a model run, stored in analyses.status, messages.status, ai_executions.status, and audit_events.result.
 * Must match the CHECK constraints in migrations/001_init.sql.
 */
export enum RunStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
}

/** Final state of a message, an execution, or an audited action. */
export type FinishedRunStatus = RunStatus.Completed | RunStatus.Failed;

/** Values allowed on ai_executions.status (no pending). */
export type ExecutionRunStatus = Exclude<RunStatus, RunStatus.Pending>;
