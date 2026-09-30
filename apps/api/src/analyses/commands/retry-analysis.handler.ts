import { Inject, Injectable } from '@nestjs/common';
import { ANALYSIS_PROMPT_VERSION } from '../../ai/contracts';
import { ErrorCode } from '../../common/constants/error-code';
import { AppError } from '../../common/http';
import { InjectConfig } from '../../config';
import { llmConfig, type LlmConfig } from '../../config/slices';
import { RunStatus } from '../../domain/run-status';
import type { AnalysisRepository } from '../../db/repositories/analysis.repository';
import { ANALYSIS_REPOSITORY } from '../../db/repositories/tokens';
import { AnalysisCommandShared } from '../analysis-command.shared';
import type { AnalysisDetailResult } from '../analysis-detail.types';
import type { RetryAnalysisCommand } from './retry-analysis.types';

/** CQRS command handler: retries a failed analysis with a new execution. */
@Injectable()
export class RetryAnalysisHandler {
  /**
   * @param llmSettings Provider and model copied into the execution row.
   * @param analyses Persistence port for compare-and-set retry reservation.
   * @param shared Rate limits and LLM orchestration.
   */
  constructor(
    @InjectConfig(llmConfig) private readonly llmSettings: LlmConfig,
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
    private readonly shared: AnalysisCommandShared,
  ) {}

  /**
   * @param command Owner, analysis id, correlation id, and abort signal.
   * @returns Detail after the retry attempt.
   * @throws AppError NOT_FOUND, CONFLICT, RATE_LIMITED, or provider failures.
   */
  async execute(command: RetryAnalysisCommand): Promise<AnalysisDetailResult> {
    const ownedAnalysis = await this.analyses.findOwned(command.owner.id, command.analysisId);
    if (!ownedAnalysis) throw new AppError(ErrorCode.NotFound, 404, 'That analysis was not found.');
    if (ownedAnalysis.status === RunStatus.Processing) {
      throw new AppError(ErrorCode.Conflict, 409, 'That analysis is still in progress.');
    }
    if (ownedAnalysis.status === RunStatus.Completed) {
      throw new AppError(
        ErrorCode.Conflict,
        409,
        'That analysis already has a result. A retry does not delete it; create a new one if you need another report.',
      );
    }
    const analysisRateLimit = this.shared.consumeAnalysisRateLimit(command.owner.id);
    if (!analysisRateLimit.ok) {
      throw new AppError(
        ErrorCode.RateLimited,
        429,
        `You exceeded the hourly analysis limit. Try again in ${analysisRateLimit.retryAfterSeconds} seconds.`,
      );
    }
    let executionId: string;
    try {
      const reserved = await this.analyses.reserveRetryWithExecution({
        ownerId: command.owner.id,
        analysisId: command.analysisId,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        provider: this.llmSettings.provider,
        model: this.shared.modelName(),
        correlationId: command.correlationId,
      });
      if (!reserved.ok) {
        this.shared.refundAnalysisRateLimit(command.owner.id);
        if (reserved.reason === 'not_found') {
          throw new AppError(ErrorCode.NotFound, 404, 'That analysis was not found.');
        }
        if (reserved.reason === 'in_progress') {
          throw new AppError(ErrorCode.Conflict, 409, 'That analysis is still in progress.');
        }
        throw new AppError(
          ErrorCode.Conflict,
          409,
          'That analysis already has a result. A retry does not delete it; create a new one if you need another report.',
        );
      }
      executionId = reserved.executionId;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.shared.refundAnalysisRateLimit(command.owner.id);
      this.shared.rethrowUniqueAsConflict(error, 'An analysis is already in progress.');
    }
    return this.shared.finishAnalysis(
      command.owner,
      command.analysisId,
      ownedAnalysis.sourceText,
      command.correlationId,
      command.signal,
      executionId,
    );
  }
}
