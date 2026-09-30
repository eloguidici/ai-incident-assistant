/** Structured log `msg` field values. */
export const LogEvent = {
  RetentionPurge: 'retention_purge',
  DatabaseNotReady: 'database_not_ready',
  PersistFailure: 'persist_failure',
  HttpError: 'http_error',
  BadJson: 'bad_json',
  Unhandled: 'unhandled',
  AppError: 'app_error',
  Request: 'request',
} as const;

export type LogEvent = (typeof LogEvent)[keyof typeof LogEvent];
