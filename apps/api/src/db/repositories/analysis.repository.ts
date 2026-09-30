import type { AnalysisResult, QuestionResult } from '../../ai/contracts';
import type { AnalysisEntity } from '../entities/analysis.entity';
import type { AiExecutionEntity } from '../entities/ai-execution.entity';
import type { MessageEntity } from '../entities/message.entity';
import type { ExecutionKind } from '../../domain/execution-kind';
import type { MessageRole } from '../../domain/message-role';
import type { ExecutionRunStatus, FinishedRunStatus } from '../../domain/run-status';

export type AnalysisListRow = Pick<
  AnalysisEntity,
  'id' | 'status' | 'sourceText' | 'result' | 'errorCode' | 'createdAt' | 'expiresAt'
>;

export type AnalysisDetailRecord = {
  analysis: AnalysisEntity;
  messages: MessageEntity[];
  executions: AiExecutionEntity[];
};

/** Persistence port for analyses, messages, executions, and related audit rows. */
export interface AnalysisRepository {
  listByOwner(ownerId: string, limit: number, offset: number): Promise<AnalysisListRow[]>;
  countByOwner(ownerId: string): Promise<number>;
  findOwned(ownerId: string, id: string): Promise<AnalysisEntity | null>;
  loadDetail(ownerId: string, id: string): Promise<AnalysisDetailRecord | null>;
  listMessages(analysisId: string, ownerId: string): Promise<MessageEntity[]>;

  reserveProcessingAnalysisWithExecution(input: {
    ownerId: string;
    sourceText: string;
    expiresAt: Date;
    kind: ExecutionKind;
    promptVersion: string;
    provider: string;
    model: string;
    correlationId: string;
  }): Promise<{ analysisId: string; executionId: string }>;

  reserveRetryWithExecution(input: {
    ownerId: string;
    analysisId: string;
    promptVersion: string;
    provider: string;
    model: string;
    correlationId: string;
  }): Promise<
    | { ok: true; executionId: string }
    | { ok: false; reason: 'not_found' | 'not_failed' | 'in_progress' }
  >;

  deleteAnalysis(id: string): Promise<void>;

  saveCompletedAnalysis(input: {
    ownerId: string;
    analysisId: string;
    result: AnalysisResult;
    promptVersion: string;
    provider: string;
    model: string;
  }): Promise<void>;

  saveFailedAnalysis(input: {
    ownerId: string;
    analysisId: string;
    errorCode: string;
    errorMessage: string;
    promptVersion: string;
    provider: string;
    model: string;
  }): Promise<void>;

  insertExecution(input: {
    analysisId: string;
    ownerId: string;
    kind: ExecutionKind;
    status: ExecutionRunStatus;
    promptVersion: string;
    provider: string;
    model: string;
    correlationId: string;
  }): Promise<{ id: string }>;

  finishExecution(input: {
    executionId: string;
    ownerId: string;
    status: FinishedRunStatus;
    errorCode: string | null;
    attemptCount: number;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    provider: string;
    model: string;
  }): Promise<void>;

  appendMessage(input: {
    analysisId: string;
    ownerId: string;
    role: MessageRole;
    content: string;
    status: FinishedRunStatus;
    result: QuestionResult | null;
    errorCode: string | null;
    sequence?: number;
  }): Promise<number>;

  hasUserMessage(analysisId: string, question: string): Promise<boolean>;

  purgeExpired(now: Date): Promise<number>;

  recoverStuckAnalyses(cutoff: Date): Promise<void>;
  recoverStuckExecutions(cutoff: Date): Promise<void>;

  insertAudit(input: {
    actorId: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    result: FinishedRunStatus;
    correlationId: string;
  }): Promise<void>;

  ping(): Promise<void>;
}
