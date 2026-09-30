import { Inject, Injectable } from '@nestjs/common';
import { ANALYSIS_PROMPT_VERSION } from '../../ai/contracts';
import { ErrorCode } from '../../common/constants/error-code';
import { AppError } from '../../common/http';
import { InjectConfig } from '../../config';
import { llmConfig, type LlmConfig } from '../../config/slices';
import { ExecutionKind } from '../../domain/execution-kind';
import type { AnalysisRepository } from '../../db/repositories/analysis.repository';
import { ANALYSIS_REPOSITORY } from '../../db/repositories/tokens';
import { AnalysisCommandShared } from '../analysis-command.shared';
import type { AnalysisDetailResult } from '../analysis-detail.types';
import type { CreateAnalysisCommand } from './create-analysis.types';

/** CQRS command handler: reserves a processing analysis and runs the model. */
@Injectable()
export class CreateAnalysisHandler {
  /**
   * @param llmSettings Provider and model copied into the execution row.
   * @param analyses Persistence port for transactional reservation.
   * @param shared Rate limits, gateway orchestration, and detail mapping.
   */
  constructor(
    @InjectConfig(llmConfig) private readonly llmSettings: LlmConfig,
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
    private readonly shared: AnalysisCommandShared,
  ) {}

  /**
   * @param command Owner, incident text, correlation id, and abort signal.
   * @returns Completed or failed detail after the model attempt.
   * @throws AppError VALIDATION_ERROR, RATE_LIMITED, CONFLICT, or provider failures.
   */
  async execute(command: CreateAnalysisCommand): Promise<AnalysisDetailResult> {
    this.shared.ensureSourceText(command.sourceText);
    const analysisRateLimit = this.shared.consumeAnalysisRateLimit(command.owner.id);
    if (!analysisRateLimit.ok) {
      throw new AppError(
        ErrorCode.RateLimited,
        429,
        `You exceeded the hourly analysis limit. Try again in ${analysisRateLimit.retryAfterSeconds} seconds.`,
      );
    }
    const expiresAt = this.shared.newExpiresAt();
    let analysisId: string;
    let executionId: string;
    try {
      const reserved = await this.analyses.reserveProcessingAnalysisWithExecution({
        ownerId: command.owner.id,
        sourceText: command.sourceText,
        expiresAt,
        kind: ExecutionKind.Analysis,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        provider: this.llmSettings.provider,
        model: this.shared.modelName(),
        correlationId: command.correlationId,
      });
      analysisId = reserved.analysisId;
      executionId = reserved.executionId;
    } catch (error) {
      this.shared.refundAnalysisRateLimit(command.owner.id);
      this.shared.rethrowUniqueAsConflict(
        error,
        'An analysis is already in progress. Wait for it to finish before sending another.',
      );
    }
    return this.shared.finishAnalysis(
      command.owner,
      analysisId,
      command.sourceText,
      command.correlationId,
      command.signal,
      executionId,
    );
  }
}
