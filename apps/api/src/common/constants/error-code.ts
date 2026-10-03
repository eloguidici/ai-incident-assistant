/** Stable API error codes returned in JSON error bodies. */
export const ErrorCode = {
  ValidationError: 'VALIDATION_ERROR',
  NotFound: 'NOT_FOUND',
  RateLimited: 'RATE_LIMITED',
  Conflict: 'CONFLICT',
  ContextLimit: 'CONTEXT_LIMIT',
  InvalidOutput: 'INVALID_OUTPUT',
  PiiUnavailable: 'PII_UNAVAILABLE',
  PiiLegacyRecord: 'PII_LEGACY_RECORD',
  DataNotSaved: 'DATA_NOT_SAVED',
  Unauthenticated: 'UNAUTHENTICATED',
  SessionExpired: 'SESSION_EXPIRED',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  Busy: 'BUSY',
  ProviderTimeout: 'PROVIDER_TIMEOUT',
  Cancelled: 'CANCELLED',
  ProviderRateLimited: 'PROVIDER_RATE_LIMITED',
  ProviderAuth: 'PROVIDER_AUTH',
  ProviderError: 'PROVIDER_ERROR',
  PayloadTooLarge: 'PAYLOAD_TOO_LARGE',
  HttpError: 'HTTP_ERROR',
  Internal: 'INTERNAL',
  Ok: 'OK',
  Csrf: 'CSRF',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
