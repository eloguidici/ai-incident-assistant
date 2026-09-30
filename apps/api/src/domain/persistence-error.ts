/** Stable error_code values persisted on analyses, messages, or ai_executions. */
export const PersistenceErrorCode = {
  Interrupted: 'INTERRUPTED',
  DbWriteFailed: 'DB_WRITE_FAILED',
} as const;

export type PersistenceErrorCode = (typeof PersistenceErrorCode)[keyof typeof PersistenceErrorCode];
