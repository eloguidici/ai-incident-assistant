import { Injectable } from '@nestjs/common';
import { logSafe } from './log';

/**
 * Nest-injectable structured logger with the same redaction rules as {@link logSafe}.
 * Use in services and handlers; middleware and CLI may call {@link logSafe} directly.
 */
@Injectable()
export class AppLogger {
  /**
   * Writes one JSON log line at info level after redaction.
   * @param fields Allowlisted structured fields (see {@link logSafe}).
   */
  info(fields: Record<string, unknown>): void {
    logSafe(fields);
  }
}
