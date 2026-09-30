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
    let outcome: LlmOutcome | undefined;
    try {
      if (this.llmSettings.faultInjection && sourceText.includes(MockFaultTag.DbFailAfter)) {
        outcome = await this.gateway.complete(buildAnalysisPrompt(sourceText), signal, Date.now() + this.llmSettings.deadlineMs);
        validateAnalysis(outcome.response.rawText, sourceText);
        throw new Error('injected-write-failure');
      }
      outcome = await this.gateway.complete(buildAnalysisPrompt(sourceText), signal, Date.now() + this.llmSettings.deadlineMs);
      const validatedAnalysis = validateAnalysis(outcome.response.rawText, sourceText);
      await this.analyses.saveCompletedAnalysis({
        ownerId: owner.id,
        analysisId,
        result: validatedAnalysis,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        provider: outcome.response.provider,
        model: outcome.response.model,
      });
      await this.finishExecution(executionId, owner.id, RunStatus.Completed, null, outcome);
      await this.audit(owner.id, AuditAction.AnalysisCreate, AuditResourceType.Analysis, analysisId, RunStatus.Completed, correlationId);
      const detail = await this.loadDetail(owner.id, analysisId);
      if (!detail) throw new AppError(ErrorCode.NotFound, 404, 'That analysis was not found.');
      return detail;
    } catch (error) {
      if (error instanceof AppError && error.errorCode === ErrorCode.Conflict) throw error;
      const appError = this.toAppError(error, analysisId);
      try {
        await this.analyses.saveFailedAnalysis({
          ownerId: owner.id,
          analysisId,
          errorCode: appError.errorCode,
          errorMessage: appError.message,
          promptVersion: ANALYSIS_PROMPT_VERSION,
          provider: this.llmSettings.provider,
          model: this.modelName(),
        });
        await this.finishExecution(executionId, owner.id, RunStatus.Failed, appError.errorCode, outcome, error);
        await this.audit(owner.id, AuditAction.AnalysisCreate, AuditResourceType.Analysis, analysisId, RunStatus.Failed, correlationId);
      } catch {
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
  ): Promise<void> {
    try {
      if (!(await this.analyses.hasUserMessage(analysisId, question))) {
        await this.analyses.appendMessage({
          analysisId,
          ownerId,
          role: MessageRole.User,
          content: question,
          status: RunStatus.Completed,
          result: null,
          errorCode: null,
        });
      }
      await this.analyses.appendMessage({
        analysisId,
        ownerId,
        role: MessageRole.Assistant,
        content: appError.message,
        status: RunStatus.Failed,
        result: null,
        errorCode: appError.errorCode,
      });
      await this.finishExecution(executionId, ownerId, RunStatus.Failed, appError.errorCode, outcome, appError);
      await this.audit(ownerId, AuditAction.QuestionAdd, AuditResourceType.Analysis, analysisId, RunStatus.Failed, correlationId);
    } catch {
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
    const history = await this.analyses.listMessages(analysisId, owner.id);
    const contextWindow = selectContext(
      sourceText,
      history.map((message) => ({ role: message.role, content: message.content })),
      question,
      this.llmSettings.contextCharBudget,
    );
    if (contextWindow.rejected) {
      throw new AppError(ErrorCode.ContextLimit, 413, 'The incident and the question exceed the context budget. The model was not called.');
    }
    let outcome: LlmOutcome | undefined;
    try {
      const sequence = await this.analyses.appendMessage({
        analysisId,
        ownerId: owner.id,
        role: MessageRole.User,
        content: question,
        status: RunStatus.Completed,
        result: null,
        errorCode: null,
      });
      const prompt = buildQuestionPrompt(sourceText, contextWindow.history, question);
      outcome = await this.gateway.complete(prompt, signal, Date.now() + this.llmSettings.deadlineMs);
      const validatedAnswer = validateQuestion(outcome.response.rawText, sourceText);
      await this.analyses.appendMessage({
        analysisId,
        ownerId: owner.id,
        role: MessageRole.Assistant,
        content: validatedAnswer.answer,
        status: RunStatus.Completed,
        result: validatedAnswer,
        errorCode: null,
        sequence: sequence + 1,
      });
      await this.finishExecution(executionId, owner.id, RunStatus.Completed, null, outcome);
      await this.audit(owner.id, AuditAction.QuestionAdd, AuditResourceType.Analysis, analysisId, RunStatus.Completed, correlationId);
      const detail = await this.loadDetail(owner.id, analysisId);
      if (!detail) throw new AppError(ErrorCode.NotFound, 404, 'That analysis was not found.');
      return detail;
    } catch (error) {
      if (error instanceof AppError && error.errorCode === ErrorCode.Conflict) throw error;
      const appError = this.toAppError(error, analysisId);
      await this.recordQuestionFailure(owner.id, analysisId, question, appError, outcome, correlationId, executionId);
      throw appError;
    }
  }

  toAppError(error: unknown, analysisId: string): AppError {
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

  private async finishExecution(
    executionId: string,
    ownerId: string,
    status: FinishedRunStatus,
    errorCode: string | null,
    outcome?: LlmOutcome,
    error?: unknown,
  ) {
    const attempts = outcome?.attempts ?? (error instanceof ProviderRequestError ? error.attempts : 1);
    await this.analyses.finishExecution({
      executionId,
      ownerId,
      status,
      errorCode,
      attemptCount: attempts,
      latencyMs: outcome?.latencyMs ?? null,
      inputTokens: outcome?.response.inputTokens ?? null,
      outputTokens: outcome?.response.outputTokens ?? null,
      provider: outcome?.response.provider ?? this.llmSettings.provider,
      model: outcome?.response.model ?? this.modelName(),
    });
  }

  private ensureText(text: string, maxLength: number, emptyMessage: string, tooLongMessage: string): void {
    if (!text.trim()) throw new AppError(ErrorCode.ValidationError, 400, emptyMessage);
    if (text.trim().length > maxLength) {
      throw new AppError(ErrorCode.ValidationError, 400, `${tooLongMessage} Maximum: ${maxLength} characters.`);
    }
  }

  private async audit(
    actorId: string | null,
    action: string,
    resourceType: string,
    resourceId: string | null,
    result: FinishedRunStatus,
    correlationId: string,
  ) {
    await this.analyses.insertAudit({ actorId, action, resourceType, resourceId, result, correlationId });
  }
}
