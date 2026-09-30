/** Structured log `msg` field values. */
export const LogEvent = {
  RetentionPurge: 'retention_purge',
  StuckRecoverySweep: 'stuck_recovery_sweep',
  DatabaseNotReady: 'database_not_ready',
  PersistFailure: 'persist_failure',
  PersistReadFailure: 'persist_read_failure',
  PersistNoOp: 'persist_no_op',
  HttpError: 'http_error',
  BadJson: 'bad_json',
  Unhandled: 'unhandled',
  AppError: 'app_error',
  Request: 'request',
} as const;

export type LogEvent = (typeof LogEvent)[keyof typeof LogEvent];
