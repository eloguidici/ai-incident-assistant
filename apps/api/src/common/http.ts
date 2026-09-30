import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ErrorCode, type ErrorCode as ErrorCodeValue } from './constants/error-code';
import { CorrelationIdHeaderName, CsrfCookieName, CsrfHeaderName } from './constants/http';
import { LogEvent } from './constants/log-event';
import { logSafe } from './log';

/** Application error returned to the client. The message is safe to show; it never includes a stack or a secret. */
export class AppError extends Error {
  /**
   * @param errorCode Stable machine code, for example `NOT_FOUND` or `RATE_LIMITED`.
   * @param status HTTP status that matches the code.
   * @param message Short explanation for the analyst.
   * @param analysisId Owning analysis when the failure happened after the row existed.
   */
  constructor(
    readonly errorCode: ErrorCodeValue,
    readonly status: number,
    message: string,
    readonly analysisId?: string,
  ) {
    super(message);
  }
}

/**
 * @param error Driver error or its `cause`.
 * @returns True when PostgreSQL rejected a unique index with code `23505`.
 */
export function isUniqueViolation(error: unknown): boolean {
  const databaseError = error as { code?: string; cause?: { code?: string }; driverError?: { code?: string } };
  return (
    databaseError?.code === '23505' ||
    databaseError?.cause?.code === '23505' ||
    databaseError?.driverError?.code === '23505'
  );
}

/**
 * Assigns a correlation id and logs the completed request without the body.
 * @param req Incoming request. A valid correlation header is reused when valid.
 * @param res Response that receives the same id.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationHeader = req.header(CorrelationIdHeaderName);
  const correlationId = correlationHeader && /^[A-Za-z0-9-]{8,80}$/.test(correlationHeader) ? correlationHeader : randomUUID();
  req.correlationId = correlationId;
  res.setHeader(CorrelationIdHeaderName, correlationId);
  const started = Date.now();
  res.on('finish', () => {
    logSafe({
      msg: LogEvent.Request,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      correlationId,
      latencyMs: Date.now() - started,
    });
  });
  next();
}

/**
 * Requires the CSRF cookie to match the CSRF header on state-changing requests.
 * Login is exempt because the cookie does not exist yet. Safe methods are exempt.
 * @returns Ends the response with 403 when the token is missing or different.
 */
export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (req.method === 'POST' && req.path === '/api/auth/login') {
    next();
    return;
  }
  const cookie = req.cookies?.[CsrfCookieName];
  const header = req.header(CsrfHeaderName);
  if (!cookie || typeof cookie !== 'string' || cookie !== header) {
    res.status(403).json({
      error: {
        code: ErrorCode.Csrf,
        message: 'The session token is missing or does not match.',
        correlationId: req.correlationId,
      },
    });
    return;
  }
  next();
}
