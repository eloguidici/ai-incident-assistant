import type { ErrorRequestHandler } from 'express';
import { ErrorCode } from './constants/error-code';

/**
 * Express error handler for `body-parser` payload limit errors.
 * Without this middleware, oversized bodies can surface as generic 500 responses.
 */
function isEntityTooLarge(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { type?: string }).type === 'entity.too.large');
}

export const payloadLimitErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  const entityTooLarge = isEntityTooLarge(error);
  if (!entityTooLarge) {
    next(error);
    return;
  }
  const correlationId = req.correlationId ?? 'missing';
  res.status(413).json({
    error: {
      code: ErrorCode.PayloadTooLarge,
      message: 'The body exceeds the allowed size.',
      correlationId,
      analysisId: null,
    },
  });
};
