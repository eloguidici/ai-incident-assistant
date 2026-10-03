/** Stable API error codes the web client compares against. */
export const ApiErrorCode = {
  HttpError: 'HTTP_ERROR',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  InvalidOutput: 'INVALID_OUTPUT',
  SessionExpired: 'SESSION_EXPIRED',
} as const;

export const CsrfCookieName = 'ia_csrf';
export const CsrfHeaderName = 'x-csrf-token';

/**
 * Run lifecycle values sent by the API in `status` fields.
 * Mirrors RunStatus in the API domain module.
 */
export enum RunStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
}
