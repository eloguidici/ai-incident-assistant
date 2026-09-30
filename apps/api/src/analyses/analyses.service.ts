import { Inject, Injectable } from '@nestjs/common';
import { InjectConfig } from '../config';
import { llmConfig, type LlmConfig } from '../config/slices';
import { AuditAction, AuditResourceType } from '../domain/audit-action';
import { RetentionCorrelationId, stuckRecoveryCutoff } from '../domain/recovery';
import { RunStatus } from '../domain/run-status';
import { ErrorCode } from '../common/constants/error-code';
import { LogEvent } from '../common/constants/log-event';
import { AppLogger } from '../common/app-logger';
import type { AnalysisRepository } from '../db/repositories/analysis.repository';
import { ANALYSIS_REPOSITORY } from '../db/repositories/tokens';

/** Retention purge and stuck-run recovery (scheduled jobs, not HTTP CQRS paths). */
@Injectable()
export class AnalysesService {
  private recoveryInFlight = false;

  /**
   * @param llmSettings Deadline used to detect stuck processing runs.
   * @param analyses Persistence port for purge and recovery updates.
   * @param logger Redacted structured logs for retention jobs.
   */
  constructor(
    @InjectConfig(llmConfig) private readonly llmSettings: LlmConfig,
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Deletes analyses whose retention date has passed, and writes one audit event.
   * @returns How many analyses were deleted. Zero when none were due.
   */
  async purgeExpired(): Promise<number> {
    const deleted = await this.analyses.purgeExpired(new Date());
    if (!deleted) return 0;
    await this.analyses.insertAudit({
      actorId: null,
      action: AuditAction.RetentionPurge,
      resourceType: AuditResourceType.Analysis,
      resourceId: null,
      result: RunStatus.Completed,
      correlationId: RetentionCorrelationId,
    });
    this.logger.info({ msg: LogEvent.RetentionPurge, deleted, errorCode: ErrorCode.Ok });
    return deleted;
  }

  /**
   * Marks analyses and executions stuck in processing past the deadline as interrupted.
   * Skips overlapping sweeps so concurrent timers do not corrupt rows.
   */
  async recoverStuck(): Promise<void> {
    if (this.recoveryInFlight) return;
    this.recoveryInFlight = true;
    try {
      const cutoff = stuckRecoveryCutoff(this.llmSettings.deadlineMs);
      await this.analyses.recoverStuck(cutoff);
      this.logger.info({ msg: LogEvent.StuckRecoverySweep, errorCode: ErrorCode.Ok });
    } catch (error) {
      this.logger.error({ msg: LogEvent.StuckRecoverySweep, errorCode: readCode(error) });
    } finally {
      this.recoveryInFlight = false;
    }
  }
}

/**
 * @param error Anything thrown by the database driver.
 * @returns The driver error code, or `unknown` when there is none.
 */
function readCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : 'unknown';
}

