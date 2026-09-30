import { ErrorCode } from '../common/constants/error-code';
import { LogEvent } from '../common/constants/log-event';
import { PersistenceErrorCode } from '../domain/persistence-error';
import type { AppLogger } from '../common/app-logger';

/** Logs a failed write after the model outcome was already committed. */
export function logPersistWriteFailed(
  logger: AppLogger,
  fields: { correlationId: string; analysisId: string },
): void {
  logger.info({
    msg: LogEvent.PersistFailure,
    errorCode: PersistenceErrorCode.DbWriteFailed,
    correlationId: fields.correlationId,
    analysisId: fields.analysisId,
  });
}

/** Logs a failed read after a successful write (client may still see the stored outcome on retry). */
export function logPersistReadFailed(
  logger: AppLogger,
  fields: { correlationId: string; analysisId: string },
): void {
  logger.info({
    msg: LogEvent.PersistReadFailure,
    errorCode: PersistenceErrorCode.DbReadFailed,
    correlationId: fields.correlationId,
    analysisId: fields.analysisId,
  });
}

/** Logs an idempotent close that did not update rows because the execution was already terminal. */
export function logPersistNoOp(
  logger: AppLogger,
  fields: { correlationId: string; analysisId: string; note: string },
): void {
  logger.info({
    msg: LogEvent.PersistNoOp,
    errorCode: ErrorCode.Ok,
    correlationId: fields.correlationId,
    analysisId: fields.analysisId,
    note: fields.note,
  });
}
