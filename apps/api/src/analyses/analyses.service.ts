import { Inject, Injectable } from '@nestjs/common';
import { MockFaultTag } from '../ai/mock-fault-tags';
import { buildAnalysisPrompt, buildQuestionPrompt } from '../ai/prompt';
import { selectContext } from '../ai/context';
import { OutputValidationError, validateAnalysis, validateQuestion } from '../ai/validate';
import { LlmGateway, providerFailure, type LlmOutcome } from '../ai/gateway';
import {
  ANALYSIS_PROMPT_VERSION,
  ProviderRequestError,
  QUESTION_PROMPT_VERSION,
  type AnalysisResult,
  type QuestionResult,
} from '../ai/contracts';
import { ErrorCode } from '../common/constants/error-code';
import { AnalysisListExcerptLength } from '../common/constants/pagination';
import { LogEvent } from '../common/constants/log-event';
import { AppError, isUniqueViolation } from '../common/http';
import { SlidingWindowLimiter } from '../common/limiters';
import { logSafe } from '../common/log';
import { InjectConfig } from '../config';
import { appConfig, limitsConfig, llmConfig, type AppConfig, type LimitsConfig, type LlmConfig } from '../config/slices';
import { AuditAction, AuditResourceType } from '../domain/audit-action';
import { ExecutionKind, type ExecutionKind as ExecutionKindValue } from '../domain/execution-kind';
import { MessageRole } from '../domain/message-role';
import { PersistenceErrorCode } from '../domain/persistence-error';
import { RetentionCorrelationId, StuckRecoveryGraceMs } from '../domain/recovery';
import { FinishedRunStatus, RunStatus } from '../domain/run-status';
import type { AnalysisRepository } from '../db/repositories/analysis.repository';
import { ANALYSIS_REPOSITORY } from '../db/repositories/tokens';

type Owner = { id: string };

@Injectable()
export class AnalysesService {
  private readonly analysisLimiter = new SlidingWindowLimiter();
  private readonly questionLimiter = new SlidingWindowLimiter();

  /**
   * @param appSettings Retention and optional fault-injection flags.
   * @param llmSettings Provider, model, and text limits for the gateway.
   * @param limitSettings Hourly caps for analyses and questions.
   * @param analyses Persistence port for analyses, messages, executions, and audit rows.
   * @param gateway Mock or OpenAI calls with retries and in-flight limits.
   */
  constructor(
    @InjectConfig(appConfig) private readonly appSettings: AppConfig,
    @InjectConfig(llmConfig) private readonly llmSettings: LlmConfig,
    @InjectConfig(limitsConfig) private readonly limitSettings: LimitsConfig,
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
    private readonly gateway: LlmGateway,
  ) {}

  /**
   * Lists one analyst's analyses, newest first.
   * @param ownerId Analyst who owns the rows.
   * @param limit Page size, already checked to be between 1 and 50.
   * @param offset Rows to skip.
   * @returns Summaries and excerpts. The full source text stays out of the list.
   */
  async list(ownerId: string, limit: number, offset: number) {
    const rows = await this.analyses.listByOwner(ownerId, limit, offset);
    const total = await this.analyses.countByOwner(ownerId);
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        excerpt: row.sourceText.slice(0, AnalysisListExcerptLength),
        summary: readSummary(row.result),
        suggestedSeverity: readSeverity(row.result),
        errorCode: row.errorCode,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
      page: { limit, offset, total },
    };
  }

  /**
   * @param ownerId Analyst who must own the analysis.
   * @param id Analysis identifier.
   * @returns The stored detail, including messages and executions.
   * @throws AppError NOT_FOUND when the id is unknown or belongs to someone else.
   */
  async get(ownerId: string, id: string) {
    const detail = await this.loadDetail(ownerId, id);
    if (!detail) throw new AppError(ErrorCode.NotFound, 404, 'That analysis was not found.');
    return detail;
  }

  /**
   * Stores a processing analysis, calls the model, and saves the validated result.
   * @param owner Analyst who will own the row.
   * @param sourceText Incident text.
   * @param correlationId Request id copied into the execution and the audit event.
   * @param signal Aborted when the client disconnects or the deadline expires.
   * @returns The completed detail.
   * @throws AppError VALIDATION_ERROR, RATE_LIMITED, CONFLICT, or a provider failure.
   */
  async create(owner: Owner, sourceText: string, correlationId: string, signal: AbortSignal) {
    this.ensureText(sourceText, this.llmSettings.sourceTextMax, 'The incident text is empty.', 'The incident text exceeds the maximum length.');
    const analysisRateLimit = this.analysisLimiter.consume(`analysis:${owner.id}`, this.limitSettings.analysesPerHour, 60 * 60 * 1000);
    if (!analysisRateLimit.ok) {
      throw new AppError(
        ErrorCode.RateLimited,
        429,
        `You exceeded the hourly analysis limit. Try again in ${analysisRateLimit.retryAfterSeconds} seconds.`,
      );
    }
    const expiresAt = new Date(Date.now() + this.appSettings.retentionDays * 24 * 60 * 60 * 1000);
    const created = await this.analyses.insertProcessingAnalysis({ ownerId: owner.id, sourceText, expiresAt });
    try {
      await this.analyses.insertExecution({
        analysisId: created.id,
        ownerId: owner.id,
        kind: ExecutionKind.Analysis,
        status: RunStatus.Processing,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        provider: this.llmSettings.provider,
        model: this.modelName(),
        correlationId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        await this.analyses.deleteAnalysis(created.id);
        this.analysisLimiter.refund(`analysis:${owner.id}`);
        throw new AppError(ErrorCode.Conflict, 409, 'An analysis is already in progress. Wait for it to finish before sending another.');
      }
      this.analysisLimiter.refund(`analysis:${owner.id}`);
      throw error;
    }
    return this.finishAnalysis(owner, created.id, sourceText, correlationId, signal);
  }

  /**
   * Runs the model again for a failed analysis. A completed result is left untouched.
   * @param id Analysis to retry.
   * @param signal Same cancellation signal as {@link create}.
   * @returns The detail after the new attempt.
   */
  async retry(owner: Owner, id: string, correlationId: string, signal: AbortSignal) {
    const ownedAnalysis = await this.analyses.findOwned(owner.id, id);
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
    const analysisRateLimit = this.analysisLimiter.consume(`analysis:${owner.id}`, this.limitSettings.analysesPerHour, 60 * 60 * 1000);
    if (!analysisRateLimit.ok) {
      throw new AppError(
        ErrorCode.RateLimited,
        429,
        `You exceeded the hourly analysis limit. Try again in ${analysisRateLimit.retryAfterSeconds} seconds.`,
      );
    }
    await this.analyses.markFailedRetryProcessing(owner.id, id);
    try {
      await this.analyses.insertExecution({
        analysisId: id,
        ownerId: owner.id,
        kind: ExecutionKind.Analysis,
        status: RunStatus.Processing,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        provider: this.llmSettings.provider,
        model: this.modelName(),
        correlationId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.analysisLimiter.refund(`analysis:${owner.id}`);
        throw new AppError(ErrorCode.Conflict, 409, 'An analysis is already in progress.');
      }
      throw error;
    }
    return this.finishAnalysis(owner, id, ownedAnalysis.sourceText, correlationId, signal);
  }

  /**
   * Appends a question and the model's answer. A failed answer does not replace the analysis result.
   * @param question Analyst question, bounded by the configured maximum.
   * @param signal Same cancellation signal as {@link create}.
   * @returns The detail including the new messages.
   */
  async addQuestion(owner: Owner, id: string, question: string, correlationId: string, signal: AbortSignal) {
    this.ensureText(question, this.llmSettings.questionMax, 'The question is empty.', 'The question exceeds the maximum length.');
    const ownedAnalysis = await this.analyses.findOwned(owner.id, id);
    if (!ownedAnalysis) throw new AppError(ErrorCode.NotFound, 404, 'That analysis was not found.');
    if (ownedAnalysis.status !== RunStatus.Completed) {
      throw new AppError(ErrorCode.Conflict, 409, 'Questions are allowed only on a completed analysis.');
    }
    const history = await this.analyses.listMessages(id, owner.id);
    const contextWindow = selectContext(
      ownedAnalysis.sourceText,
      history.map((message) => ({ role: message.role, content: message.content })),
      question,
      this.llmSettings.contextCharBudget,
    );
    if (contextWindow.rejected) {
      throw new AppError(ErrorCode.ContextLimit, 413, 'The incident and the question exceed the context budget. The model was not called.');
    }
    const questionRateLimit = this.questionLimiter.consume(`question:${owner.id}`, this.limitSettings.questionsPerHour, 60 * 60 * 1000);
    if (!questionRateLimit.ok) {
      throw new AppError(
        ErrorCode.RateLimited,
        429,
        `You exceeded the hourly question limit. Try again in ${questionRateLimit.retryAfterSeconds} seconds.`,
      );
    }
    try {
      await this.analyses.insertExecution({
        analysisId: id,
        ownerId: owner.id,
        kind: ExecutionKind.Question,
        status: RunStatus.Processing,
        promptVersion: QUESTION_PROMPT_VERSION,
        provider: this.llmSettings.provider,
        model: this.modelName(),
        correlationId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.questionLimiter.refund(`question:${owner.id}`);
        throw new AppError(ErrorCode.Conflict, 409, 'A question is already in progress for this analysis.');
      }
      throw error;
    }
    let outcome: LlmOutcome | undefined;
    try {
      const sequence = await this.analyses.appendMessage({
        analysisId: id,
        ownerId: owner.id,
        role: MessageRole.User,
        content: question,
        status: RunStatus.Completed,
        result: null,
        errorCode: null,
      });
      const prompt = buildQuestionPrompt(ownedAnalysis.sourceText, contextWindow.history, question);
      outcome = await this.gateway.complete(prompt, signal, Date.now() + this.llmSettings.deadlineMs);
      const validatedAnswer = validateQuestion(outcome.response.rawText, ownedAnalysis.sourceText);
      await this.analyses.appendMessage({
        analysisId: id,
        ownerId: owner.id,
        role: MessageRole.Assistant,
        content: validatedAnswer.answer,
        status: RunStatus.Completed,
        result: validatedAnswer,
        errorCode: null,
        sequence: sequence + 1,
      });
      await this.finishExecution(id, owner.id, ExecutionKind.Question, RunStatus.Completed, null, outcome);
      await this.audit(owner.id, AuditAction.QuestionAdd, AuditResourceType.Analysis, id, RunStatus.Completed, correlationId);
      const detail = await this.loadDetail(owner.id, id);
      if (!detail) throw new AppError(ErrorCode.NotFound, 404, 'That analysis was not found.');
      return detail;
    } catch (error) {
      if (error instanceof AppError && error.errorCode === ErrorCode.Conflict) throw error;
      const appError = this.toAppError(error, id);
      await this.recordQuestionFailure(owner.id, id, question, appError, outcome, correlationId);
      throw appError;
    }
  }

  /**
   * Deletes analyses whose retention date has passed, and writes one audit event.
   * @returns How many analyses were deleted. Zero when none were due.
   */
  async purgeExpired(): Promise<number> {
    const deleted = await this.analyses.purgeExpired(new Date());
    if (!deleted) return 0;
    await this.audit(null, AuditAction.RetentionPurge, AuditResourceType.Analysis, null, RunStatus.Completed, RetentionCorrelationId);
    logSafe({ msg: LogEvent.RetentionPurge, deleted, errorCode: ErrorCode.Ok });
    return deleted;
  }

  /** Marks analyses and executions stuck in processing past the deadline as interrupted. */
  async recoverStuck(): Promise<void> {
    const cutoff = new Date(Date.now() - this.llmSettings.deadlineMs - StuckRecoveryGraceMs);
    await this.analyses.recoverStuckAnalyses(cutoff);
    await this.analyses.recoverStuckExecutions(cutoff);
  }

  private async finishAnalysis(owner: Owner, analysisId: string, sourceText: string, correlationId: string, signal: AbortSignal) {
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
      await this.finishExecution(analysisId, owner.id, ExecutionKind.Analysis, RunStatus.Completed, null, outcome);
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
        await this.finishExecution(analysisId, owner.id, ExecutionKind.Analysis, RunStatus.Failed, appError.errorCode, outcome, error);
        await this.audit(owner.id, AuditAction.AnalysisCreate, AuditResourceType.Analysis, analysisId, RunStatus.Failed, correlationId);
      } catch {
        logSafe({ msg: LogEvent.PersistFailure, errorCode: PersistenceErrorCode.DbWriteFailed, correlationId, analysisId });
      }
      throw appError;
    }
  }

  private async recordQuestionFailure(
    ownerId: string,
    analysisId: string,
    question: string,
    appError: AppError,
    outcome: LlmOutcome | undefined,
    correlationId: string,
  ) {
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
      await this.finishExecution(analysisId, ownerId, ExecutionKind.Question, RunStatus.Failed, appError.errorCode, outcome, appError);
      await this.audit(ownerId, AuditAction.QuestionAdd, AuditResourceType.Analysis, analysisId, RunStatus.Failed, correlationId);
    } catch {
      logSafe({ msg: LogEvent.PersistFailure, errorCode: PersistenceErrorCode.DbWriteFailed, correlationId, analysisId });
    }
  }

  private async finishExecution(
    analysisId: string,
    ownerId: string,
    kind: ExecutionKindValue,
    status: FinishedRunStatus,
    errorCode: string | null,
    outcome?: LlmOutcome,
    error?: unknown,
  ) {
    const attempts = outcome?.attempts ?? (error instanceof ProviderRequestError ? error.attempts : 1);
    await this.analyses.finishExecution({
      analysisId,
      ownerId,
      kind,
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

  private async loadDetail(ownerId: string, id: string) {
    const loaded = await this.analyses.loadDetail(ownerId, id);
    if (!loaded) return null;
    const { analysis: row, messages: thread, executions } = loaded;
    return {
      id: row.id,
      status: row.status,
      sourceText: row.sourceText,
      result: (row.result as AnalysisResult | null) ?? null,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      promptVersion: row.promptVersion,
      provider: row.provider,
      model: row.model,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      messages: thread.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status,
        result: (message.result as QuestionResult | null) ?? null,
        errorCode: message.errorCode,
        sequence: message.sequence,
        createdAt: message.createdAt.toISOString(),
      })),
      executions: executions.map((execution) => ({
        kind: execution.kind,
        status: execution.status,
        promptVersion: execution.promptVersion,
        provider: execution.provider,
        model: execution.model,
        attemptCount: execution.attemptCount,
        latencyMs: execution.latencyMs,
        inputTokens: execution.inputTokens,
        outputTokens: execution.outputTokens,
        errorCode: execution.errorCode,
        createdAt: execution.createdAt.toISOString(),
      })),
    };
  }

  private toAppError(error: unknown, analysisId: string): AppError {
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

  private ensureText(text: string, maxLength: number, emptyMessage: string, tooLongMessage: string): void {
    if (!text.trim()) throw new AppError(ErrorCode.ValidationError, 400, emptyMessage);
    if (text.trim().length > maxLength) {
      throw new AppError(ErrorCode.ValidationError, 400, `${tooLongMessage} Maximum: ${maxLength} characters.`);
    }
  }

  private modelName(): string {
    return this.llmSettings.provider === 'mock' ? 'mock-incident-v1' : this.llmSettings.model;
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

/**
 * @param storedAnalysis JSON column value from an analysis row.
 * @returns The summary string when present, otherwise null.
 */
function readSummary(storedAnalysis: unknown): string | null {
  if (!storedAnalysis || typeof storedAnalysis !== 'object' || !('summary' in storedAnalysis)) return null;
  const summary = (storedAnalysis as { summary?: unknown }).summary;
  return typeof summary === 'string' ? summary : null;
}

/**
 * @param storedAnalysis JSON column value from an analysis row.
 * @returns The suggested severity string when present, otherwise null.
 */
function readSeverity(storedAnalysis: unknown): string | null {
  if (!storedAnalysis || typeof storedAnalysis !== 'object' || !('suggestedSeverity' in storedAnalysis)) return null;
  const severity = (storedAnalysis as { suggestedSeverity?: unknown }).suggestedSeverity;
  return typeof severity === 'string' ? severity : null;
}
