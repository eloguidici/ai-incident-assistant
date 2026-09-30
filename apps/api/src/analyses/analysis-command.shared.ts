import { Inject, Injectable } from '@nestjs/common';
import { MockFaultTag } from '../ai/mock-fault-tags';
import { buildAnalysisPrompt, buildQuestionPrompt } from '../ai/prompt';
import { selectContext } from '../ai/context';
import { OutputValidationError, validateAnalysis, validateQuestion } from '../ai/validate';
import { LlmGateway, providerFailure, type LlmOutcome } from '../ai/gateway';
import { ANALYSIS_PROMPT_VERSION, ProviderRequestError } from '../ai/contracts';
import { ErrorCode } from '../common/constants/error-code';
import { LogEvent } from '../common/constants/log-event';
import { AppError, isUniqueViolation } from '../common/http';
import { SlidingWindowLimiter } from '../common/limiters';
import { AppLogger } from '../common/app-logger';
import { InjectConfig } from '../config';
import { appConfig, limitsConfig, llmConfig, type AppConfig, type LimitsConfig, type LlmConfig } from '../config/slices';
import { AuditAction, AuditResourceType } from '../domain/audit-action';
import { MessageRole } from '../domain/message-role';
import { PersistenceErrorCode } from '../domain/persistence-error';
import { FinishedRunStatus, RunStatus } from '../domain/run-status';
import type { AnalysisRepository } from '../db/repositories/analysis.repository';
import { ANALYSIS_REPOSITORY } from '../db/repositories/tokens';
import { mapAnalysisDetail } from './analysis-detail.mapper';
import type { AnalysisDetailResult } from './analysis-detail.types';

export type AnalysisOwner = { id: string };

/** Shared LLM orchestration, rate limits, and persistence helpers for analysis commands. */
@Injectable()
export class AnalysisCommandShared {
  readonly analysisLimiter = new SlidingWindowLimiter();
  readonly questionLimiter = new SlidingWindowLimiter();

  /**
   * @param appSettings Retention and optional fault-injection flags.
   * @param llmSettings Provider, model, and text limits for the gateway.
   * @param limitSettings Hourly caps for analyses and questions.
   * @param analyses Persistence port for analyses, messages, executions, and audit rows.
   * @param gateway Mock or OpenAI calls with retries and in-flight limits.
   * @param logger Redacted structured logs for persistence failures.
   */
  constructor(
    @InjectConfig(appConfig) private readonly appSettings: AppConfig,
    @InjectConfig(llmConfig) private readonly llmSettings: LlmConfig,
    @InjectConfig(limitsConfig) private readonly limitSettings: LimitsConfig,
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
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
    const contextWindow = selectContext(
      sourceText,
      history.map((message) => ({ role: message.role, content: message.content })),
      question,
      this.llmSettings.contextCharBudget,
    );
    if (contextWindow.rejected) {
      throw new AppError(ErrorCode.ContextLimit, 413, 'The incident and the question exceed the context budget. The model was not called.');
    }
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
   * Marks a reserved question execution as failed without calling the model.
   * @param executionId Reserved row to close.
   */
  async abortQuestionExecution(
    executionId: string,
    ownerId: string,
    errorCode: string,
    correlationId: string,
    analysisId: string,
  ): Promise<void> {
    const closed = await this.analyses.finishExecution({
      executionId,
      ownerId,
      status: RunStatus.Failed,
      errorCode,
      attemptCount: 0,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      provider: this.llmSettings.provider,
      model: this.modelName(),
    });
    if (!closed) {
      this.logger.info({ msg: LogEvent.PersistFailure, errorCode: PersistenceErrorCode.DbWriteFailed, correlationId, analysisId });
    }
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
        injectMidTransactionFailure:
          this.llmSettings.faultInjection && sourceText.includes(MockFaultTag.DbFailAfter),
      });
      if (commit === 'stale') {
        throw new AppError(ErrorCode.Conflict, 409, 'This analysis run is no longer active.');
      }
      persisted = true;
      return await this.loadDetailOrThrow(owner.id, analysisId);
    } catch (error) {
      if (error instanceof AppError && error.errorCode === ErrorCode.Conflict) throw error;
      if (persisted) {
        this.logger.info({ msg: LogEvent.PersistFailure, errorCode: PersistenceErrorCode.DbWriteFailed, correlationId, analysisId });
        return await this.loadDetailOrThrow(owner.id, analysisId);
      }
      const appError = this.toAppError(error, analysisId, outcome);
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
          attemptCount: this.attemptCount(outcome, error),
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
        this.logger.info({ msg: LogEvent.PersistFailure, errorCode: PersistenceErrorCode.DbWriteFailed, correlationId, analysisId });
      }
      throw appError;
    }
  }

  /**
   * Appends assistant failure messages and finishes the question execution.
   * @param executionId Question execution to mark failed.
   */
  async recordQuestionFailure(
    ownerId: string,
    analysisId: string,
    question: string,
    appError: AppError,
    outcome: LlmOutcome | undefined,
    correlationId: string,
    executionId: string,
    userMessageStored: boolean,
  ): Promise<void> {
    try {
      const commit = await this.analyses.commitQuestionFailure({
        ownerId,
        analysisId,
        executionId,
        question,
        userMessageStored,
        errorCode: appError.errorCode,
        errorMessage: appError.message,
        attemptCount: this.attemptCount(outcome, appError),
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
      this.logger.info({ msg: LogEvent.PersistFailure, errorCode: PersistenceErrorCode.DbWriteFailed, correlationId, analysisId });
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
    await this.ensureQuestionContext(owner.id, analysisId, sourceText, question);
    const deadlineAt = Date.now() + this.llmSettings.deadlineMs;
    let outcome: LlmOutcome | undefined;
    let persisted = false;
    let userSequence = 0;
    try {
      userSequence = await this.analyses.appendMessage({
        analysisId,
        ownerId: owner.id,
        role: MessageRole.User,
        content: question,
        status: RunStatus.Completed,
        result: null,
        errorCode: null,
      });
      const history = await this.analyses.listMessages(analysisId, owner.id);
      const contextWindow = selectContext(
        sourceText,
        history.map((message) => ({ role: message.role, content: message.content })),
        question,
        this.llmSettings.contextCharBudget,
      );
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
      return await this.loadDetailOrThrow(owner.id, analysisId);
    } catch (error) {
      if (error instanceof AppError && error.errorCode === ErrorCode.Conflict) throw error;
      if (persisted) {
        this.logger.info({ msg: LogEvent.PersistFailure, errorCode: PersistenceErrorCode.DbWriteFailed, correlationId, analysisId });
        return await this.loadDetailOrThrow(owner.id, analysisId);
      }
      const appError = this.toAppError(error, analysisId, outcome);
      await this.recordQuestionFailure(
        owner.id,
        analysisId,
        question,
        appError,
        outcome,
        correlationId,
        executionId,
        userSequence > 0,
      );
      throw appError;
    }
  }

  /**
   * @param outcome Provider metrics when the model was called.
   * @param error Original failure, used for attempt counts on provider errors.
   */
  toAppError(error: unknown, analysisId: string, _outcome?: LlmOutcome): AppError {
    if (error instanceof AppError) return error;
    if (error instanceof ProviderRequestError) return providerFailure(error, analysisId);
    if (error instanceof OutputValidationError) {
      return new AppError(
        ErrorCode.InvalidOutput,
        422,
        'The model output did not match the contract and is not shown as a result.',
        analysisId,
      );
    }
    return new AppError(
      ErrorCode.DataNotSaved,
      500,
      'The result could not be saved. It was not marked as successful.',
      analysisId,
    );
  }

  /** @throws AppError when a unique index blocks concurrent processing. */
  rethrowUniqueAsConflict(error: unknown, message: string): never {
    if (isUniqueViolation(error)) {
      throw new AppError(ErrorCode.Conflict, 409, message);
    }
    throw error;
  }

  private attemptCount(outcome: LlmOutcome | undefined, error: unknown): number {
    if (outcome) return outcome.attempts;
    if (error instanceof ProviderRequestError) return error.attempts;
    return 1;
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
