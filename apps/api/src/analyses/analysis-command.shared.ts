import { Inject, Injectable } from '@nestjs/common';
import { buildAnalysisPrompt, buildQuestionPrompt } from '../ai/prompt';
import { validateAnalysis, validateQuestion } from '../ai/validate';
import { orchestrationAttemptCount, toOrchestrationAppError } from './analysis-orchestration.errors';
import { resolveQuestionContextWindow } from './question-context';
import { LlmGateway, type LlmOutcome } from '../ai/gateway';
import { ANALYSIS_PROMPT_VERSION } from '../ai/contracts';
import { ErrorCode } from '../common/constants/error-code';
import { SlidingWindowLimiter } from '../common/limiters';
import { AppLogger } from '../common/app-logger';
import { InjectConfig } from '../config';
import { appConfig, limitsConfig, llmConfig, type AppConfig, type LimitsConfig, type LlmConfig } from '../config/slices';
import { AuditAction, AuditResourceType } from '../domain/audit-action';
import { MessageRole } from '../domain/message-role';
import { FinishedRunStatus, RunStatus } from '../domain/run-status';
import type { AnalysisRepository } from '../db/repositories/analysis.repository';
import { ANALYSIS_REPOSITORY } from '../db/repositories/tokens';
import { mapAnalysisDetail } from './analysis-detail.mapper';
import type { AnalysisDetailResult } from './analysis-detail.types';
import { AnalysesService } from './analyses.service';
import { logPersistNoOp, logPersistReadFailed, logPersistWriteFailed } from './persistence-orchestration.log';
import type { QuestionFailureRecord } from './question-failure.types';
import { AppError, isUniqueViolation } from '../common/http';

export type AnalysisOwner = { id: string };

type ExecutionFinishFields = {
  attemptCount: number;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  provider: string;
  model: string;
};

/** Shared LLM orchestration, rate limits, and persistence helpers for analysis commands. */
@Injectable()
export class AnalysisCommandShared {
  readonly analysisLimiter = new SlidingWindowLimiter();
  readonly questionLimiter = new SlidingWindowLimiter();

  /**
   * @param appSettings Retention settings.
   * @param llmSettings Provider, model, and text limits for the gateway.
   * @param limitSettings Hourly caps for analyses and questions.
   * @param analyses Persistence port for analyses, messages, executions, and audit rows.
   * @param analysesMaintenance Scheduled recovery when persistence fallbacks cannot close a row.
   * @param gateway Mock or OpenAI calls with retries and in-flight limits.
   * @param logger Redacted structured logs for persistence failures.
   */
  constructor(
    @InjectConfig(appConfig) private readonly appSettings: AppConfig,
    @InjectConfig(llmConfig) private readonly llmSettings: LlmConfig,
    @InjectConfig(limitsConfig) private readonly limitSettings: LimitsConfig,
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
    private readonly analysesMaintenance: AnalysesService,
    private readonly gateway: LlmGateway,
    private readonly logger: AppLogger,
  ) {}

  /**
   * @param ownerId Analyst who must own the analysis.
   * @param id Analysis identifier.
   * @returns The stored detail, including messages and executions.
   */
  async loadDetail(ownerId: string, id: string): Promise<AnalysisDetailResult | null> {
    const loaded = await this.analyses.loadDetail(ownerId, id);
    if (!loaded) return null;
    return mapAnalysisDetail(loaded);
  }

  /**
   * Validates incident text length before a create or retry reserves a row.
   * @param text Raw incident text.
   * @throws AppError VALIDATION_ERROR when empty or too long.
   */
  ensureSourceText(text: string): void {
    this.ensureText(text, this.llmSettings.sourceTextMax, 'The incident text is empty.', 'The incident text exceeds the maximum length.');
  }

  /**
   * Validates question length before an execution is inserted.
   * @param question Raw question text.
   * @throws AppError VALIDATION_ERROR when empty or too long.
   */
  ensureQuestionText(question: string): void {
    this.ensureText(question, this.llmSettings.questionMax, 'The question is empty.', 'The question exceeds the maximum length.');
  }

  /**
   * Ensures the incident, thread, and question fit the context budget before reserving a question execution.
   * @throws AppError CONTEXT_LIMIT when the model must not be called.
   */
  async ensureQuestionContext(ownerId: string, analysisId: string, sourceText: string, question: string): Promise<void> {
    const history = await this.analyses.listMessages(analysisId, ownerId);
    resolveQuestionContextWindow(sourceText, history, question, this.llmSettings.contextCharBudget);
  }

  /**
   * Consumes one analysis slot for the owner.
   * @returns When not ok, caller must not proceed and should throw RATE_LIMITED.
   */
  consumeAnalysisRateLimit(ownerId: string) {
    return this.analysisLimiter.consume(`analysis:${ownerId}`, this.limitSettings.analysesPerHour, 60 * 60 * 1000);
  }

  /** Refunds one analysis slot after a failed reservation. */
  refundAnalysisRateLimit(ownerId: string): void {
    this.analysisLimiter.refund(`analysis:${ownerId}`);
  }

  /**
   * Consumes one question slot for the owner.
   * @returns When not ok, caller must not proceed and should throw RATE_LIMITED.
   */
  consumeQuestionRateLimit(ownerId: string) {
    return this.questionLimiter.consume(`question:${ownerId}`, this.limitSettings.questionsPerHour, 60 * 60 * 1000);
  }

  /** Refunds one question slot after a failed execution insert. */
  refundQuestionRateLimit(ownerId: string): void {
    this.questionLimiter.refund(`question:${ownerId}`);
  }

  /** @returns Retention expiry for a newly created analysis. */
  newExpiresAt(): Date {
    return new Date(Date.now() + this.appSettings.retentionDays * 24 * 60 * 60 * 1000);
  }

  modelName(): string {
    return this.llmSettings.provider === 'mock' ? 'mock-incident-v1' : this.llmSettings.model;
  }

  /**
   * Runs the model after a processing analysis was reserved.
   * @param executionId Execution row to finish on success or failure.
   * @returns Completed detail.
   */
  async finishAnalysis(
    owner: AnalysisOwner,
    analysisId: string,
    sourceText: string,
    correlationId: string,
    signal: AbortSignal,
    executionId: string,
  ): Promise<AnalysisDetailResult> {
    const deadlineAt = Date.now() + this.llmSettings.deadlineMs;
    let outcome: LlmOutcome | undefined;
    let persisted = false;
    try {
      outcome = await this.gateway.complete(buildAnalysisPrompt(sourceText), signal, deadlineAt);
      const validatedAnalysis = validateAnalysis(outcome.response.rawText, sourceText);
      const commit = await this.analyses.commitAnalysisSuccess({
        ownerId: owner.id,
        analysisId,
        executionId,
        result: validatedAnalysis,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        provider: outcome.response.provider,
        model: outcome.response.model,
        attemptCount: outcome.attempts,
        latencyMs: outcome.latencyMs,
        inputTokens: outcome.response.inputTokens,
        outputTokens: outcome.response.outputTokens,
        audit: this.auditPayload(owner.id, AuditAction.AnalysisCreate, analysisId, RunStatus.Completed, correlationId),
      });
      if (commit === 'stale') {
        throw new AppError(ErrorCode.Conflict, 409, 'This analysis run is no longer active.');
      }
      persisted = true;
      return await this.loadDetailAfterPersist(owner.id, analysisId, correlationId);
    } catch (error) {
      if (error instanceof AppError && error.errorCode === ErrorCode.Conflict) throw error;
      if (persisted) {
        logPersistReadFailed(this.logger, { correlationId, analysisId });
        return await this.loadDetailOrThrow(owner.id, analysisId);
      }
      const appError = toOrchestrationAppError(error, analysisId, outcome);
      try {
        const commit = await this.analyses.commitAnalysisFailure({
          ownerId: owner.id,
          analysisId,
          executionId,
          errorCode: appError.errorCode,
          errorMessage: appError.message,
          promptVersion: ANALYSIS_PROMPT_VERSION,
          provider: outcome?.response.provider ?? this.llmSettings.provider,
          model: outcome?.response.model ?? this.modelName(),
          attemptCount: orchestrationAttemptCount(outcome, error),
          latencyMs: outcome?.latencyMs ?? null,
          inputTokens: outcome?.response.inputTokens ?? null,
          outputTokens: outcome?.response.outputTokens ?? null,
          audit: this.auditPayload(owner.id, AuditAction.AnalysisCreate, analysisId, RunStatus.Failed, correlationId),
        });
        if (commit === 'stale') {
          throw new AppError(ErrorCode.Conflict, 409, 'This analysis run is no longer active.');
        }
      } catch (inner) {
        if (inner instanceof AppError) throw inner;
        logPersistWriteFailed(this.logger, { correlationId, analysisId });
        await this.fallbackCloseAnalysisExecution(
          owner.id,
          analysisId,
          executionId,
          appError,
          outcome,
          error,
          correlationId,
        );
      }
      throw appError;
    }
  }

  /**
   * Appends assistant failure messages and finishes the question execution.
   * @param record Failure context for one question run.
   */
  async recordQuestionFailure(record: QuestionFailureRecord): Promise<void> {
    const {
      ownerId,
      analysisId,
      question,
      appError,
      sourceError,
      outcome,
      correlationId,
      executionId,
      userMessageStored,
    } = record;
    try {
      const commit = await this.analyses.commitQuestionFailure({
        ownerId,
        analysisId,
        executionId,
        question,
        userMessageStored,
        errorCode: appError.errorCode,
        errorMessage: appError.message,
        attemptCount: orchestrationAttemptCount(outcome, sourceError),
        latencyMs: outcome?.latencyMs ?? null,
        inputTokens: outcome?.response.inputTokens ?? null,
        outputTokens: outcome?.response.outputTokens ?? null,
        provider: outcome?.response.provider ?? this.llmSettings.provider,
        model: outcome?.response.model ?? this.modelName(),
        audit: this.auditPayload(ownerId, AuditAction.QuestionAdd, analysisId, RunStatus.Failed, correlationId),
      });
      if (commit === 'stale') {
        throw new AppError(ErrorCode.Conflict, 409, 'This question run is no longer active.');
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      logPersistWriteFailed(this.logger, { correlationId, analysisId });
      await this.fallbackCloseQuestionExecution(ownerId, analysisId, executionId, appError, sourceError, outcome, correlationId);
    }
  }

  /**
   * Closes the execution row when the full failure transaction could not commit (messages/audit may be missing).
   * Idempotent: a no-op when the execution was already finished by a concurrent path.
   */
  private async fallbackCloseQuestionExecution(
    ownerId: string,
    analysisId: string,
    executionId: string,
    appError: AppError,
    sourceError: unknown,
    outcome: LlmOutcome | undefined,
    correlationId: string,
  ): Promise<void> {
    const finishFields = this.executionFinishFields(outcome, sourceError);
    try {
      const closed = await this.analyses.finishExecution({
        executionId,
        ownerId,
        status: RunStatus.Failed,
        errorCode: appError.errorCode,
        ...finishFields,
      });
      if (!closed) {
        logPersistNoOp(this.logger, {
          correlationId,
          analysisId,
          note: 'question_execution_already_closed',
        });
        return;
      }
    } catch (inner) {
      if (inner instanceof AppError) throw inner;
      logPersistWriteFailed(this.logger, { correlationId, analysisId });
      void this.analysesMaintenance.recoverStuck();
    }
  }

  /** Closes analysis and execution rows when the failure transaction could not commit. */
  private async fallbackCloseAnalysisExecution(
    ownerId: string,
    analysisId: string,
    executionId: string,
    appError: AppError,
    outcome: LlmOutcome | undefined,
    sourceError: unknown,
    correlationId: string,
  ): Promise<void> {
    const finishFields = this.executionFinishFields(outcome, sourceError);
    try {
      const closed = await this.analyses.finishExecution({
        executionId,
        ownerId,
        status: RunStatus.Failed,
        errorCode: appError.errorCode,
        ...finishFields,
      });
      await this.analyses.saveFailedAnalysis({
        ownerId,
        analysisId,
        errorCode: appError.errorCode,
        errorMessage: appError.message,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        provider: finishFields.provider,
        model: finishFields.model,
      });
      if (!closed) {
        logPersistNoOp(this.logger, {
          correlationId,
          analysisId,
          note: 'analysis_execution_already_closed',
        });
      }
    } catch (inner) {
      if (inner instanceof AppError) throw inner;
      logPersistWriteFailed(this.logger, { correlationId, analysisId });
      void this.analysesMaintenance.recoverStuck();
    }
  }

  /**
   * Builds the question prompt context and calls the model.
   * @param executionId Question execution reserved before the user message is stored.
   */
  async completeQuestion(
    owner: AnalysisOwner,
    analysisId: string,
    sourceText: string,
    question: string,
    correlationId: string,
    signal: AbortSignal,
    executionId: string,
  ): Promise<AnalysisDetailResult> {
    const deadlineAt = Date.now() + this.llmSettings.deadlineMs;
    let outcome: LlmOutcome | undefined;
    let persisted = false;
    let userSequence = 0;
    try {
      const priorHistory = await this.analyses.listMessages(analysisId, owner.id);
      const contextWindow = resolveQuestionContextWindow(
        sourceText,
        priorHistory,
        question,
        this.llmSettings.contextCharBudget,
      );
      userSequence = await this.analyses.appendMessage({
        analysisId,
        ownerId: owner.id,
        role: MessageRole.User,
        content: question,
        status: RunStatus.Completed,
        result: null,
        errorCode: null,
      });
      const prompt = buildQuestionPrompt(sourceText, contextWindow.history, question);
      outcome = await this.gateway.complete(prompt, signal, deadlineAt);
      const validatedAnswer = validateQuestion(outcome.response.rawText, sourceText);
      const commit = await this.analyses.commitQuestionSuccess({
        ownerId: owner.id,
        analysisId,
        executionId,
        assistantContent: validatedAnswer.answer,
        assistantResult: validatedAnswer,
        assistantSequence: userSequence + 1,
        attemptCount: outcome.attempts,
        latencyMs: outcome.latencyMs,
        inputTokens: outcome.response.inputTokens,
        outputTokens: outcome.response.outputTokens,
        provider: outcome.response.provider,
        model: outcome.response.model,
        audit: this.auditPayload(owner.id, AuditAction.QuestionAdd, analysisId, RunStatus.Completed, correlationId),
      });
      if (commit === 'stale') {
        throw new AppError(ErrorCode.Conflict, 409, 'This question run is no longer active.');
      }
      persisted = true;
      return await this.loadDetailAfterPersist(owner.id, analysisId, correlationId);
    } catch (error) {
      if (error instanceof AppError && error.errorCode === ErrorCode.Conflict) throw error;
      if (persisted) {
        logPersistReadFailed(this.logger, { correlationId, analysisId });
        return await this.loadDetailOrThrow(owner.id, analysisId);
      }
      const appError = toOrchestrationAppError(error, analysisId, outcome);
      await this.recordQuestionFailure({
        ownerId: owner.id,
        analysisId,
        question,
        appError,
        sourceError: error,
        outcome,
        correlationId,
        executionId,
        userMessageStored: userSequence > 0,
      });
      throw appError;
    }
  }

  /** @throws AppError when a unique index blocks concurrent processing. */
  rethrowUniqueAsConflict(error: unknown, message: string): never {
    if (isUniqueViolation(error)) {
      throw new AppError(ErrorCode.Conflict, 409, message);
    }
    throw error;
  }

  private executionFinishFields(outcome: LlmOutcome | undefined, sourceError: unknown): ExecutionFinishFields {
    return {
      attemptCount: orchestrationAttemptCount(outcome, sourceError),
      latencyMs: outcome?.latencyMs ?? null,
      inputTokens: outcome?.response.inputTokens ?? null,
      outputTokens: outcome?.response.outputTokens ?? null,
      provider: outcome?.response.provider ?? this.llmSettings.provider,
      model: outcome?.response.model ?? this.modelName(),
    };
  }

  private auditPayload(
    actorId: string,
    action: string,
    resourceId: string,
    result: FinishedRunStatus,
    correlationId: string,
  ) {
    return {
      actorId,
      action,
      resourceType: AuditResourceType.Analysis,
      resourceId,
      result,
      correlationId,
    };
  }

  private async loadDetailAfterPersist(
    ownerId: string,
    analysisId: string,
    correlationId: string,
  ): Promise<AnalysisDetailResult> {
    try {
      return await this.loadDetailOrThrow(ownerId, analysisId);
    } catch (error) {
      logPersistReadFailed(this.logger, { correlationId, analysisId });
      throw error;
    }
  }

  private async loadDetailOrThrow(ownerId: string, analysisId: string): Promise<AnalysisDetailResult> {
    const detail = await this.loadDetail(ownerId, analysisId);
    if (!detail) throw new AppError(ErrorCode.NotFound, 404, 'That analysis was not found.');
    return detail;
  }

  private ensureText(text: string, maxLength: number, emptyMessage: string, tooLongMessage: string): void {
    if (!text.trim()) throw new AppError(ErrorCode.ValidationError, 400, emptyMessage);
    if (text.trim().length > maxLength) {
      throw new AppError(ErrorCode.ValidationError, 400, `${tooLongMessage} Maximum: ${maxLength} characters.`);
    }
  }
}
