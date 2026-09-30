import { Inject, Injectable } from '@nestjs/common';
import { QUESTION_PROMPT_VERSION } from '../../ai/contracts';
import { ErrorCode } from '../../common/constants/error-code';
import { AppError } from '../../common/http';
import { InjectConfig } from '../../config';
import { llmConfig, type LlmConfig } from '../../config/slices';
import { ExecutionKind } from '../../domain/execution-kind';
import { RunStatus } from '../../domain/run-status';
import type { AnalysisRepository } from '../../db/repositories/analysis.repository';
import { ANALYSIS_REPOSITORY } from '../../db/repositories/tokens';
import { AnalysisCommandShared } from '../analysis-command.shared';
import type { AnalysisDetailResult } from '../analysis-detail.types';
import type { AddQuestionCommand } from './add-question.types';

/** CQRS command handler: appends a follow-up question and calls the model. */
@Injectable()
export class AddQuestionHandler {
  /**
   * @param llmSettings Provider and model copied into the execution row.
   * @param analyses Persistence port for messages and executions.
   * @param shared Validation, rate limits, and question orchestration.
   */
  constructor(
    @InjectConfig(llmConfig) private readonly llmSettings: LlmConfig,
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
    private readonly shared: AnalysisCommandShared,
  ) {}

  /**
   * @param command Owner, analysis id, question, correlation id, and abort signal.
   * @returns Detail including new messages when successful.
   * @throws AppError NOT_FOUND, CONFLICT, RATE_LIMITED, CONTEXT_LIMIT, or provider failures.
   */
  async execute(command: AddQuestionCommand): Promise<AnalysisDetailResult> {
    this.shared.ensureQuestionText(command.question);
    const ownedAnalysis = await this.analyses.findOwned(command.owner.id, command.analysisId);
    if (!ownedAnalysis) throw new AppError(ErrorCode.NotFound, 404, 'That analysis was not found.');
    if (ownedAnalysis.status !== RunStatus.Completed) {
      throw new AppError(ErrorCode.Conflict, 409, 'Questions are allowed only on a completed analysis.');
    }
    const questionRateLimit = this.shared.consumeQuestionRateLimit(command.owner.id);
    if (!questionRateLimit.ok) {
      throw new AppError(
        ErrorCode.RateLimited,
        429,
        `You exceeded the hourly question limit. Try again in ${questionRateLimit.retryAfterSeconds} seconds.`,
      );
    }
    let executionId: string;
    try {
      const started = await this.analyses.insertExecution({
        analysisId: command.analysisId,
        ownerId: command.owner.id,
        kind: ExecutionKind.Question,
        status: RunStatus.Processing,
        promptVersion: QUESTION_PROMPT_VERSION,
        provider: this.llmSettings.provider,
        model: this.shared.modelName(),
        correlationId: command.correlationId,
      });
      executionId = started.id;
    } catch (error) {
      this.shared.refundQuestionRateLimit(command.owner.id);
      this.shared.rethrowUniqueAsConflict(error, 'A question is already in progress for this analysis.');
    }
    return this.shared.completeQuestion(
      command.owner,
      command.analysisId,
      ownedAnalysis.sourceText,
      command.question,
      command.correlationId,
      command.signal,
      executionId,
    );
  }
}
