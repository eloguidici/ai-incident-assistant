import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan, Repository } from 'typeorm';
import { MessageRole } from '../../../domain/message-role';
import { PersistenceErrorCode } from '../../../domain/persistence-error';
import { RunStatus } from '../../../domain/run-status';
import { AnalysisEntity } from '../../entities/analysis.entity';
import { AiExecutionEntity } from '../../entities/ai-execution.entity';
import { AuditEventEntity } from '../../entities/audit-event.entity';
import { MessageEntity } from '../../entities/message.entity';
import type {
  AnalysisDetailRecord,
  AnalysisListRow,
  AnalysisRepository,
  AppendMessageInput,
  AuditInput,
  CommitAnalysisFailureInput,
  CommitAnalysisSuccessInput,
  CommitOutcome,
  CommitQuestionFailureInput,
  CommitQuestionSuccessInput,
  ExecutionMetrics,
  FinishExecutionInput,
  InsertExecutionInput,
  ReserveAnalysisInput,
  ReserveRetryInput,
  ReserveRetryResult,
} from '../analysis.repository';

@Injectable()
export class TypeOrmAnalysisRepository implements AnalysisRepository {
  /**
   * @param dataSource Runs transactional message inserts.
   * @param analyses Analysis rows.
   * @param messages Thread rows.
   * @param executions Model run rows.
   * @param auditEvents Append-only audit log.
   */
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AnalysisEntity) private readonly analyses: Repository<AnalysisEntity>,
    @InjectRepository(MessageEntity) private readonly messages: Repository<MessageEntity>,
    @InjectRepository(AiExecutionEntity) private readonly executions: Repository<AiExecutionEntity>,
    @InjectRepository(AuditEventEntity) private readonly auditEvents: Repository<AuditEventEntity>,
  ) {}

  /** @inheritdoc */
  async listByOwner(ownerId: string, limit: number, offset: number): Promise<AnalysisListRow[]> {
    const rows = await this.analyses
      .createQueryBuilder('analysis')
      .select('analysis.id', 'id')
      .addSelect('analysis.status', 'status')
      .addSelect('analysis.sourceText', 'sourceText')
      .addSelect('analysis.piiPolicyVersion', 'piiPolicyVersion')
      .addSelect('analysis.errorCode', 'errorCode')
      .addSelect('analysis.createdAt', 'createdAt')
      .addSelect('analysis.expiresAt', 'expiresAt')
      .addSelect(`analysis.result->>'summary'`, 'resultSummary')
      .addSelect(`analysis.result->>'suggestedSeverity'`, 'resultSeverity')
      .where('analysis.ownerId = :ownerId', { ownerId })
      .orderBy('analysis.createdAt', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{
        id: string;
        status: AnalysisEntity['status'];
        sourceText: string;
        piiPolicyVersion: string | null;
        errorCode: string | null;
        createdAt: Date;
        expiresAt: Date;
        resultSummary: string | null;
        resultSeverity: string | null;
      }>();
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      sourceText: row.sourceText,
      piiPolicyVersion: row.piiPolicyVersion,
      errorCode: row.errorCode,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      resultSummary: row.resultSummary,
      resultSeverity: row.resultSeverity,
    }));
  }

  /** @inheritdoc */
  async countByOwner(ownerId: string): Promise<number> {
    return this.analyses.count({ where: { ownerId } });
  }

  /** @inheritdoc */
  async findOwned(ownerId: string, id: string): Promise<AnalysisEntity | null> {
    return this.analyses.findOne({ where: { id, ownerId } });
  }

  /** @inheritdoc */
  async loadDetail(ownerId: string, id: string): Promise<AnalysisDetailRecord | null> {
    const analysis = await this.findOwned(ownerId, id);
    if (!analysis) return null;
    const messages = await this.listMessages(id, ownerId);
    const executions = await this.executions.find({
      where: { analysisId: id, ownerId },
      order: { createdAt: 'ASC' },
    });
    return { analysis, messages, executions };
  }

  /** @inheritdoc */
  async listMessages(analysisId: string, ownerId: string): Promise<MessageEntity[]> {
    return this.messages.find({
      where: { analysisId, ownerId },
      order: { sequence: 'ASC' },
    });
  }

  /** @inheritdoc */
  async reserveProcessingAnalysisWithExecution(input: ReserveAnalysisInput): Promise<{ analysisId: string; executionId: string }> {
    return this.dataSource.transaction(async (manager) => {
      const analysis = await manager.save(
        AnalysisEntity,
        manager.create(AnalysisEntity, {
          id: input.analysisId,
          piiPolicyVersion: input.piiPolicyVersion ?? null,
          ownerId: input.ownerId,
          sourceText: input.sourceText,
          status: RunStatus.Processing,
          expiresAt: input.expiresAt,
          updatedAt: new Date(),
        }),
      );
      const insert = await manager.insert(AiExecutionEntity, {
        analysisId: analysis.id,
        ownerId: input.ownerId,
        kind: input.kind,
        status: RunStatus.Processing,
        promptVersion: input.promptVersion,
        provider: input.provider,
        model: input.model,
        correlationId: input.correlationId,
      });
      const executionId = insert.identifiers[0]?.id as string;
      return { analysisId: analysis.id, executionId };
    });
  }

  /** @inheritdoc */
  async reserveRetryWithExecution(input: ReserveRetryInput): Promise<ReserveRetryResult> {
    return this.dataSource.transaction(async (manager) => {
      const updated = await manager.update(
        AnalysisEntity,
        { id: input.analysisId, ownerId: input.ownerId, status: RunStatus.Failed },
        { status: RunStatus.Processing, errorCode: null, errorMessage: null, updatedAt: new Date() },
      );
      if (!updated.affected) {
        const current = await manager.findOne(AnalysisEntity, {
          where: { id: input.analysisId, ownerId: input.ownerId },
        });
        if (!current) return { ok: false, reason: 'not_found' };
        if (current.status === RunStatus.Processing) return { ok: false, reason: 'in_progress' };
        return { ok: false, reason: 'not_failed' };
      }
      const insert = await manager.insert(AiExecutionEntity, {
        analysisId: input.analysisId,
        ownerId: input.ownerId,
        kind: 'analysis',
        status: RunStatus.Processing,
        promptVersion: input.promptVersion,
        provider: input.provider,
        model: input.model,
        correlationId: input.correlationId,
      });
      const executionId = insert.identifiers[0]?.id as string;
      return { ok: true, executionId };
    });
  }

  /** @inheritdoc */
  async deleteAnalysis(id: string): Promise<void> {
    await this.analyses.delete({ id });
  }

  /** @inheritdoc */
  async insertExecution(input: InsertExecutionInput): Promise<{ id: string }> {
    const insert = await this.executions.insert({
      analysisId: input.analysisId,
      ownerId: input.ownerId,
      kind: input.kind,
      status: input.status,
      promptVersion: input.promptVersion,
      provider: input.provider,
      model: input.model,
      correlationId: input.correlationId,
    });
    return { id: insert.identifiers[0]?.id as string };
  }

  /** @inheritdoc */
  async finishExecution(input: FinishExecutionInput): Promise<boolean> {
    const updated = await this.executions.update(
      {
        id: input.executionId,
        ownerId: input.ownerId,
        status: RunStatus.Processing,
      },
      {
        status: input.status,
        errorCode: input.errorCode,
        ...executionMetrics(input),
        finishedAt: new Date(),
      },
    );
    return (updated.affected ?? 0) > 0;
  }

  /** @inheritdoc */
  async commitAnalysisSuccess(input: CommitAnalysisSuccessInput): Promise<CommitOutcome> {
    return this.dataSource.transaction(async (manager) => {
      if (!(await this.lockProcessingAnalysis(manager, input.ownerId, input.analysisId))) return 'stale';
      const executionUpdate = await manager.update(
        AiExecutionEntity,
        { id: input.executionId, analysisId: input.analysisId, ownerId: input.ownerId, kind: 'analysis', status: RunStatus.Processing },
        {
          status: RunStatus.Completed,
          errorCode: null,
          ...executionMetrics(input),
          finishedAt: new Date(),
        },
      );
      if (!executionUpdate.affected) return 'stale';
      const analysisUpdate = await manager.update(
        AnalysisEntity,
        { id: input.analysisId, ownerId: input.ownerId, status: RunStatus.Processing },
        {
          status: RunStatus.Completed,
          result: input.result,
          errorCode: null,
          errorMessage: null,
          promptVersion: input.promptVersion,
          provider: input.provider,
          model: input.model,
          updatedAt: new Date(),
        },
      );
      if (!analysisUpdate.affected) throw new Error('analysis_commit_inconsistent');
      await manager.insert(AuditEventEntity, auditRow(input.audit));
      return 'committed';
    });
  }

  /** @inheritdoc */
  async commitAnalysisFailure(input: CommitAnalysisFailureInput): Promise<CommitOutcome> {
    return this.persistAnalysisFailure(input);
  }

  /** @inheritdoc */
  async closeAnalysisFailure(
    input: Omit<CommitAnalysisFailureInput, 'audit'>,
  ): Promise<CommitOutcome> {
    return this.persistAnalysisFailure(input);
  }

  /** Closes the matching execution and analysis in one transaction; stale attempts cannot modify a retry. */
  private async persistAnalysisFailure(
    input: Omit<CommitAnalysisFailureInput, 'audit'> & { audit?: AuditInput },
  ): Promise<CommitOutcome> {
    return this.dataSource.transaction(async (manager) => {
      if (!(await this.lockProcessingAnalysis(manager, input.ownerId, input.analysisId))) return 'stale';
      const executionUpdate = await manager.update(
        AiExecutionEntity,
        { id: input.executionId, analysisId: input.analysisId, ownerId: input.ownerId, kind: 'analysis', status: RunStatus.Processing },
        {
          status: RunStatus.Failed,
          errorCode: input.errorCode,
          ...executionMetrics(input),
          finishedAt: new Date(),
        },
      );
      if (!executionUpdate.affected) return 'stale';
      const analysisUpdate = await manager.update(
        AnalysisEntity,
        { id: input.analysisId, ownerId: input.ownerId, status: RunStatus.Processing },
        {
          status: RunStatus.Failed,
          result: null,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          promptVersion: input.promptVersion,
          provider: input.provider,
          model: input.model,
          updatedAt: new Date(),
        },
      );
      if (!analysisUpdate.affected) throw new Error('analysis_commit_inconsistent');
      if (input.audit) await manager.insert(AuditEventEntity, auditRow(input.audit));
      return 'committed';
    });
  }

  /** @inheritdoc */
  async commitQuestionSuccess(input: CommitQuestionSuccessInput): Promise<CommitOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const executionUpdate = await manager.update(
        AiExecutionEntity,
        { id: input.executionId, ownerId: input.ownerId, status: RunStatus.Processing },
        {
          status: RunStatus.Completed,
          errorCode: null,
          ...executionMetrics(input),
          finishedAt: new Date(),
        },
      );
      if (!executionUpdate.affected) return 'stale';
      await manager.insert(MessageEntity, {
        analysisId: input.analysisId,
        ownerId: input.ownerId,
        role: MessageRole.Assistant,
        content: input.assistantContent,
        status: RunStatus.Completed,
        result: input.assistantResult,
        errorCode: null,
        sequence: input.assistantSequence,
      });
      await manager.insert(AuditEventEntity, auditRow(input.audit));
      return 'committed';
    });
  }

  /** @inheritdoc */
  async commitQuestionFailure(input: CommitQuestionFailureInput): Promise<CommitOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const executionUpdate = await manager.update(
        AiExecutionEntity,
        { id: input.executionId, ownerId: input.ownerId, status: RunStatus.Processing },
        {
          status: RunStatus.Failed,
          errorCode: input.errorCode,
          ...executionMetrics(input),
          finishedAt: new Date(),
        },
      );
      if (!executionUpdate.affected) return 'stale';
      if (!input.userMessageStored) {
        const sequence = await nextSequence(manager, input.analysisId);
        await manager.insert(MessageEntity, {
          analysisId: input.analysisId,
          ownerId: input.ownerId,
          role: MessageRole.User,
          content: input.question,
          status: RunStatus.Completed,
          result: null,
          errorCode: null,
          sequence,
        });
      }
      const assistantSequence = await nextSequence(manager, input.analysisId);
      await manager.insert(MessageEntity, {
        analysisId: input.analysisId,
        ownerId: input.ownerId,
        role: MessageRole.Assistant,
        content: input.errorMessage,
        status: RunStatus.Failed,
        result: null,
        errorCode: input.errorCode,
        sequence: assistantSequence,
      });
      await manager.insert(AuditEventEntity, auditRow(input.audit));
      return 'committed';
    });
  }

  /** @inheritdoc */
  async appendMessage(input: AppendMessageInput): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      let sequence = input.sequence;
      if (!sequence) {
        sequence = await nextSequence(manager, input.analysisId);
      }
      await manager.insert(MessageEntity, {
        analysisId: input.analysisId,
        ownerId: input.ownerId,
        role: input.role,
        content: input.content,
        status: input.status,
        result: input.result,
        errorCode: input.errorCode,
        sequence,
      });
      return sequence;
    });
  }

  /** @inheritdoc */
  async hasUserMessage(analysisId: string, question: string): Promise<boolean> {
    const count = await this.messages.count({
      where: { analysisId, content: question, role: MessageRole.User },
    });
    return count > 0;
  }

  /** @inheritdoc */
  async purgeExpired(now: Date): Promise<number> {
    const result = await this.analyses
      .createQueryBuilder()
      .delete()
      .where('expires_at < :now', { now })
      .execute();
    return result.affected ?? 0;
  }

  /** @inheritdoc */
  async recoverStuck(cutoff: Date): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // Use the same analysis -> execution lock order as normal completion/retry.
      // SKIP LOCKED lets another instance finish a row without a recovery deadlock.
      const interrupted = await manager.createQueryBuilder(AnalysisEntity, 'analysis')
        .where(`(
          analysis.status = :status AND analysis.updatedAt < :cutoff
          AND NOT EXISTS (SELECT 1 FROM ai_executions execution
            WHERE execution.analysis_id = analysis.id AND execution.kind = 'analysis'
            AND execution.status = :status AND execution.created_at >= :cutoff)
        ) OR (
          analysis.status <> :status
          AND EXISTS (SELECT 1 FROM ai_executions execution
            WHERE execution.analysis_id = analysis.id AND execution.kind = 'analysis'
            AND execution.status = :status AND execution.created_at < :cutoff)
        )`, { status: RunStatus.Processing, cutoff })
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      const ids = interrupted.map((analysis) => analysis.id);
      if (ids.length) {
        await manager.update(AiExecutionEntity,
          { analysisId: In(ids), kind: 'analysis', status: RunStatus.Processing, createdAt: LessThan(cutoff) },
          { status: RunStatus.Failed, errorCode: PersistenceErrorCode.Interrupted, finishedAt: new Date() });
        await manager.update(AnalysisEntity, { id: In(ids), status: RunStatus.Processing }, {
          status: RunStatus.Failed,
          errorCode: PersistenceErrorCode.Interrupted,
          errorMessage: 'The run was interrupted before a result was saved.',
          updatedAt: new Date(),
        });
      }
      await manager.createQueryBuilder().update(AiExecutionEntity)
        .set({ status: RunStatus.Failed, errorCode: PersistenceErrorCode.Interrupted, finishedAt: new Date() })
        .where('status = :status', { status: RunStatus.Processing })
        .andWhere('kind = :kind', { kind: 'question' })
        .andWhere('created_at < :cutoff', { cutoff })
        .execute();
    });
  }

  /** Locks the analysis before its execution so recovery and completion use a consistent order. */
  private async lockProcessingAnalysis(manager: EntityManager, ownerId: string, analysisId: string): Promise<boolean> {
    const analysis = await manager.findOne(AnalysisEntity, {
      where: { id: analysisId, ownerId, status: RunStatus.Processing },
      lock: { mode: 'pessimistic_write' },
    });
    return analysis !== null;
  }

  /** @inheritdoc */
  async insertAudit(input: AuditInput): Promise<void> {
    await this.auditEvents.insert(auditRow(input));
  }

  /** @inheritdoc */
  async ping(): Promise<void> {
    await this.dataSource.query('SELECT 1');
  }
}

/**
 * Provider metrics copied onto an execution row when it finishes.
 * @param input Any input that carries {@link ExecutionMetrics}.
 */
function executionMetrics(input: ExecutionMetrics): ExecutionMetrics {
  return {
    attemptCount: input.attemptCount,
    latencyMs: input.latencyMs,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    provider: input.provider,
    model: input.model,
  };
}

/**
 * Audit row with exactly the audited fields, so no other input property reaches the table.
 * @param audit Actor, action, resource, result and correlation id.
 */
function auditRow(audit: AuditInput): AuditInput {
  return {
    actorId: audit.actorId,
    action: audit.action,
    resourceType: audit.resourceType,
    resourceId: audit.resourceId,
    result: audit.result,
    correlationId: audit.correlationId,
  };
}

/**
 * Next message sequence in the thread, read inside the caller's transaction.
 * @param manager Transaction manager.
 * @param analysisId Thread owner.
 * @returns The current maximum sequence plus one, or 1 for an empty thread.
 */
async function nextSequence(manager: EntityManager, analysisId: string): Promise<number> {
  const row = await manager
    .createQueryBuilder(MessageEntity, 'message')
    .select('COALESCE(MAX(message.sequence), 0)', 'maxSequence')
    .where('message.analysisId = :analysisId', { analysisId })
    .getRawOne<{ maxSequence: string | number | null }>();
  return Number(row?.maxSequence ?? 0) + 1;
}
