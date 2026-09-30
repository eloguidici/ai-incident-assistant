import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode } from './constants/error-code';
import { LogEvent } from './constants/log-event';
import { AppError } from './http';
import { logSafe } from './log';

@Catch()
/** Maps every exception to the public error shape and a redacted log line. */
export class AllExceptionsFilter implements ExceptionFilter {
  /**
   * @param exception Caught error. Stacks are not written to the response.
   * @param host Nest host used to reach the HTTP request and response.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    if (response.headersSent) return;
    const correlationId = request.correlationId || 'missing';

    if (exception instanceof AppError) {
      logSafe({
        msg: LogEvent.AppError,
        errorCode: exception.errorCode,
        status: exception.status,
        correlationId,
        analysisId: exception.analysisId ?? null,
      });
      response.status(exception.status).json({
        error: {
          code: exception.errorCode,
          message: exception.message,
          correlationId,
          analysisId: exception.analysisId ?? null,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === 404 ? ErrorCode.NotFound : status === 413 ? ErrorCode.PayloadTooLarge : ErrorCode.HttpError;
      const message =
        status === 404
          ? 'Not found.'
          : status === 413
            ? 'The body exceeds the allowed size.'
            : 'The request could not be completed.';
      logSafe({ msg: LogEvent.HttpError, errorCode: code, status, correlationId });
      response.status(status).json({ error: { code, message, correlationId, analysisId: null } });
      return;
    }

    if (exception instanceof SyntaxError) {
      logSafe({ msg: LogEvent.BadJson, errorCode: ErrorCode.ValidationError, status: 400, correlationId });
      response.status(400).json({
        error: {
          code: ErrorCode.ValidationError,
          message: 'The body is not valid JSON.',
          correlationId,
          analysisId: null,
        },
      });
      return;
    }

    const pgCode = readPgCode(exception);
    logSafe({ msg: LogEvent.Unhandled, errorCode: pgCode ?? ErrorCode.Internal, status: 500, correlationId });
    response.status(500).json({
      error: { code: ErrorCode.Internal, message: 'Internal error.', correlationId, analysisId: null },
    });
  }
}

/**
 * @param error Unknown failure, possibly wrapping a driver error in `cause`.
 * @returns A five-character PostgreSQL code, or null when none is present.
 */
function readPgCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const databaseError = error as { code?: unknown; cause?: { code?: unknown } };
  const code = databaseError.code ?? databaseError.cause?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}
