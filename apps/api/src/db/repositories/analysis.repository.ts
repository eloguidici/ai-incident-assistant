import type { AnalysisResult, QuestionResult } from '../../ai/contracts';
import type { AnalysisEntity } from '../entities/analysis.entity';
import type { AiExecutionEntity } from '../entities/ai-execution.entity';
import type { MessageEntity } from '../entities/message.entity';
import type { ExecutionKind } from '../../domain/execution-kind';
import type { MessageRole } from '../../domain/message-role';
import type { ExecutionRunStatus, FinishedRunStatus } from '../../domain/run-status';

export type AnalysisListRow = Pick<
  AnalysisEntity,
  'id' | 'status' | 'sourceText' | 'errorCode' | 'createdAt' | 'expiresAt'
> & {
  /** Summary excerpt from the stored JSON result (list views do not load the full blob). */
  resultSummary: string | null;
  /** Severity excerpt from the stored JSON result. */
  resultSeverity: string | null;
};

export type AnalysisDetailRecord = {
  analysis: AnalysisEntity;
  messages: MessageEntity[];
  executions: AiExecutionEntity[];
};

/** Audit event written in the same transaction as the state change it describes. */
export type AuditInput = {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: FinishedRunStatus;
  correlationId: string;
};

/** Provider metrics recorded when an execution finishes. */
export type ExecutionMetrics = {
  attemptCount: number;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  provider: string;
  model: string;
};

export type ReserveAnalysisInput = {
  ownerId: string;
  sourceText: string;
  expiresAt: Date;
  kind: ExecutionKind;
  promptVersion: string;
  provider: string;
  model: string;
  correlationId: string;
};

export type ReserveRetryInput = {
  ownerId: string;
  analysisId: string;
  promptVersion: string;
  provider: string;
  model: string;
  correlationId: string;
};

export type ReserveRetryResult =
  | { ok: true; executionId: string }
  | { ok: false; reason: 'not_found' | 'not_failed' | 'in_progress' };

export type InsertExecutionInput = {
  analysisId: string;
  ownerId: string;
  kind: ExecutionKind;
  status: ExecutionRunStatus;
  promptVersion: string;
  provider: string;
  model: string;
  correlationId: string;
};

export type FinishExecutionInput = ExecutionMetrics & {
  executionId: string;
  ownerId: string;
  status: FinishedRunStatus;
  errorCode: string | null;
};

export type CommitAnalysisSuccessInput = ExecutionMetrics & {
  ownerId: string;
  analysisId: string;
  executionId: string;
  result: AnalysisResult;
  promptVersion: string;
  audit: AuditInput;
};

export type CommitAnalysisFailureInput = ExecutionMetrics & {
  ownerId: string;
  analysisId: string;
  executionId: string;
  errorCode: string;
  errorMessage: string;
  promptVersion: string;
  audit: AuditInput;
};

export type CommitQuestionSuccessInput = ExecutionMetrics & {
  ownerId: string;
  analysisId: string;
  executionId: string;
  assistantContent: string;
  assistantResult: QuestionResult;
  assistantSequence: number;
  audit: AuditInput;
};

export type CommitQuestionFailureInput = ExecutionMetrics & {
  ownerId: string;
  analysisId: string;
  executionId: string;
  question: string;
  userMessageStored: boolean;
  errorCode: string;
  errorMessage: string;
  audit: AuditInput;
};

export type AppendMessageInput = {
  analysisId: string;
  ownerId: string;
  role: MessageRole;
  content: string;
  status: FinishedRunStatus;
  result: QuestionResult | null;
  errorCode: string | null;
  sequence?: number;
};

export type CommitOutcome = 'committed' | 'stale';

/** Persistence port for analyses, messages, executions, and related audit rows. */
export interface AnalysisRepository {
  listByOwner(ownerId: string, limit: number, offset: number): Promise<AnalysisListRow[]>;
  countByOwner(ownerId: string): Promise<number>;
  findOwned(ownerId: string, id: string): Promise<AnalysisEntity | null>;
  loadDetail(ownerId: string, id: string): Promise<AnalysisDetailRecord | null>;
  listMessages(analysisId: string, ownerId: string): Promise<MessageEntity[]>;

  reserveProcessingAnalysisWithExecution(input: ReserveAnalysisInput): Promise<{ analysisId: string; executionId: string }>;

  reserveRetryWithExecution(input: ReserveRetryInput): Promise<ReserveRetryResult>;

  deleteAnalysis(id: string): Promise<void>;

  insertExecution(input: InsertExecutionInput): Promise<{ id: string }>;

  finishExecution(input: FinishExecutionInput): Promise<boolean>;

  commitAnalysisSuccess(input: CommitAnalysisSuccessInput): Promise<CommitOutcome>;

  commitAnalysisFailure(input: CommitAnalysisFailureInput): Promise<CommitOutcome>;

  /** Minimal atomic failure close, scoped to an execution; omits audit if the full commit failed. */
  closeAnalysisFailure(input: Omit<CommitAnalysisFailureInput, 'audit'>): Promise<CommitOutcome>;

  commitQuestionSuccess(input: CommitQuestionSuccessInput): Promise<CommitOutcome>;

  commitQuestionFailure(input: CommitQuestionFailureInput): Promise<CommitOutcome>;

  appendMessage(input: AppendMessageInput): Promise<number>;

  hasUserMessage(analysisId: string, question: string): Promise<boolean>;

  purgeExpired(now: Date): Promise<number>;

  /** Atomically reconciles aged analysis runs and closes aged questions. */
  recoverStuck(cutoff: Date): Promise<void>;

  insertAudit(input: AuditInput): Promise<void>;

  ping(): Promise<void>;
}
