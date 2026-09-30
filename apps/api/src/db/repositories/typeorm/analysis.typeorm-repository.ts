import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { AnalysisResult, QuestionResult } from '../../../ai/contracts';
import { MessageRole } from '../../../domain/message-role';
import { PersistenceErrorCode } from '../../../domain/persistence-error';
import { RunStatus, type ExecutionRunStatus, type FinishedRunStatus } from '../../../domain/run-status';
import { AnalysisEntity } from '../../entities/analysis.entity';
import { AiExecutionEntity } from '../../entities/ai-execution.entity';
import { AuditEventEntity } from '../../entities/audit-event.entity';
import { MessageEntity } from '../../entities/message.entity';
import type { AnalysisDetailRecord, AnalysisListRow, AnalysisRepository } from '../analysis.repository';

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
    return this.analyses.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
      select: ['id', 'status', 'sourceText', 'result', 'errorCode', 'createdAt', 'expiresAt'],
    });
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
  async reserveProcessingAnalysisWithExecution(input: {
    ownerId: string;
    sourceText: string;
    expiresAt: Date;
    kind: 'analysis' | 'question';
    promptVersion: string;
    provider: string;
    model: string;
    correlationId: string;
  }): Promise<{ analysisId: string; executionId: string }> {
    return this.dataSource.transaction(async (manager) => {
      const analysis = await manager.save(
        AnalysisEntity,
        manager.create(AnalysisEntity, {
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
  async reserveRetryWithExecution(input: {
    ownerId: string;
    analysisId: string;
    promptVersion: string;
    provider: string;
    model: string;
    correlationId: string;
  }): Promise<
    | { ok: true; executionId: string }
    | { ok: false; reason: 'not_found' | 'not_failed' | 'in_progress' }
  > {
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
  async saveCompletedAnalysis(input: {
    ownerId: string;
    analysisId: string;
    result: AnalysisResult;
    promptVersion: string;
    provider: string;
    model: string;
  }): Promise<void> {
    await this.analyses.update(
      { id: input.analysisId, ownerId: input.ownerId },
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
  }

  /** @inheritdoc */
  async saveFailedAnalysis(input: {
    ownerId: string;
    analysisId: string;
    errorCode: string;
    errorMessage: string;
    promptVersion: string;
    provider: string;
    model: string;
  }): Promise<void> {
    await this.analyses.update(
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
  }

  /** @inheritdoc */
  async insertExecution(input: {
    analysisId: string;
    ownerId: string;
    kind: 'analysis' | 'question';
    status: ExecutionRunStatus;
    promptVersion: string;
    provider: string;
    model: string;
    correlationId: string;
  }): Promise<{ id: string }> {
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
  async finishExecution(input: {
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
  }): Promise<boolean> {
    const updated = await this.executions.update(
      {
        id: input.executionId,
        ownerId: input.ownerId,
        status: RunStatus.Processing,
      },
      {
        status: input.status,
        errorCode: input.errorCode,
        attemptCount: input.attemptCount,
        latencyMs: input.latencyMs,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        provider: input.provider,
        model: input.model,
        finishedAt: new Date(),
      },
    );
    return (updated.affected ?? 0) > 0;
  }

  /** @inheritdoc */
  async commitAnalysisSuccess(input: {
    ownerId: string;
    analysisId: string;
    executionId: string;
    result: AnalysisResult;
    promptVersion: string;
    provider: string;
    model: string;
    attemptCount: number;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    audit: {
      actorId: string | null;
      action: string;
      resourceType: string;
      resourceId: string | null;
      result: FinishedRunStatus;
      correlationId: string;
    };
    injectMidTransactionFailure?: boolean;
  }): Promise<'committed' | 'stale'> {
    return this.dataSource.transaction(async (manager) => {
      const executionUpdate = await manager.update(
        AiExecutionEntity,
        { id: input.executionId, ownerId: input.ownerId, status: RunStatus.Processing },
        {
          status: RunStatus.Completed,
          errorCode: null,
          attemptCount: input.attemptCount,
          latencyMs: input.latencyMs,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          provider: input.provider,
          model: input.model,
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
      if (input.injectMidTransactionFailure) throw new Error('injected-write-failure');
      await manager.insert(AuditEventEntity, {
        actorId: input.audit.actorId,
        action: input.audit.action,
        resourceType: input.audit.resourceType,
        resourceId: input.audit.resourceId,
        result: input.audit.result,
        correlationId: input.audit.correlationId,
      });
      return 'committed';
    });
  }

  /** @inheritdoc */
  async commitAnalysisFailure(input: {
    ownerId: string;
    analysisId: string;
    executionId: string;
    errorCode: string;
    errorMessage: string;
    promptVersion: string;
    provider: string;
    model: string;
    attemptCount: number;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    audit: {
      actorId: string | null;
      action: string;
      resourceType: string;
      resourceId: string | null;
      result: FinishedRunStatus;
      correlationId: string;
    };
  }): Promise<'committed' | 'stale'> {
    return this.dataSource.transaction(async (manager) => {
      const executionUpdate = await manager.update(
        AiExecutionEntity,
        { id: input.executionId, ownerId: input.ownerId, status: RunStatus.Processing },
        {
          status: RunStatus.Failed,
          errorCode: input.errorCode,
          attemptCount: input.attemptCount,
          latencyMs: input.latencyMs,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          provider: input.provider,
          model: input.model,
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
      await manager.insert(AuditEventEntity, {
        actorId: input.audit.actorId,
        action: input.audit.action,
        resourceType: input.audit.resourceType,
        resourceId: input.audit.resourceId,
        result: input.audit.result,
        correlationId: input.audit.correlationId,
      });
      return 'committed';
    });
  }

  /** @inheritdoc */
  async commitQuestionSuccess(input: {
    ownerId: string;
    analysisId: string;
    executionId: string;
    assistantContent: string;
    assistantResult: QuestionResult;
    assistantSequence: number;
    attemptCount: number;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    provider: string;
    model: string;
    audit: {
      actorId: string | null;
      action: string;
      resourceType: string;
      resourceId: string | null;
      result: FinishedRunStatus;
      correlationId: string;
    };
  }): Promise<'committed' | 'stale'> {
    return this.dataSource.transaction(async (manager) => {
      const executionUpdate = await manager.update(
        AiExecutionEntity,
        { id: input.executionId, ownerId: input.ownerId, status: RunStatus.Processing },
        {
          status: RunStatus.Completed,
          errorCode: null,
          attemptCount: input.attemptCount,
          latencyMs: input.latencyMs,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          provider: input.provider,
          model: input.model,
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
      await manager.insert(AuditEventEntity, {
        actorId: input.audit.actorId,
        action: input.audit.action,
        resourceType: input.audit.resourceType,
        resourceId: input.audit.resourceId,
        result: input.audit.result,
        correlationId: input.audit.correlationId,
      });
      return 'committed';
    });
  }

  /** @inheritdoc */
  async commitQuestionFailure(input: {
    ownerId: string;
    analysisId: string;
    executionId: string;
    question: string;
    userMessageStored: boolean;
    errorCode: string;
    errorMessage: string;
    attemptCount: number;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    provider: string;
    model: string;
    audit: {
      actorId: string | null;
      action: string;
      resourceType: string;
      resourceId: string | null;
      result: FinishedRunStatus;
      correlationId: string;
    };
  }): Promise<'committed' | 'stale'> {
    return this.dataSource.transaction(async (manager) => {
      const executionUpdate = await manager.update(
        AiExecutionEntity,
        { id: input.executionId, ownerId: input.ownerId, status: RunStatus.Processing },
        {
          status: RunStatus.Failed,
          errorCode: input.errorCode,
          attemptCount: input.attemptCount,
          latencyMs: input.latencyMs,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          provider: input.provider,
          model: input.model,
          finishedAt: new Date(),
        },
      );
      if (!executionUpdate.affected) return 'stale';
      if (!input.userMessageStored) {
        const row = await manager
          .createQueryBuilder(MessageEntity, 'message')
          .select('COALESCE(MAX(message.sequence), 0)', 'maxSequence')
          .where('message.analysisId = :analysisId', { analysisId: input.analysisId })
          .getRawOne<{ maxSequence: string | number | null }>();
        const sequence = Number(row?.maxSequence ?? 0) + 1;
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
      const row = await manager
        .createQueryBuilder(MessageEntity, 'message')
        .select('COALESCE(MAX(message.sequence), 0)', 'maxSequence')
        .where('message.analysisId = :analysisId', { analysisId: input.analysisId })
        .getRawOne<{ maxSequence: string | number | null }>();
      const assistantSequence = Number(row?.maxSequence ?? 0) + 1;
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
      await manager.insert(AuditEventEntity, {
        actorId: input.audit.actorId,
        action: input.audit.action,
        resourceType: input.audit.resourceType,
        resourceId: input.audit.resourceId,
        result: input.audit.result,
        correlationId: input.audit.correlationId,
      });
      return 'committed';
    });
  }

  /** @inheritdoc */
  async appendMessage(input: {
    analysisId: string;
    ownerId: string;
    role: 'user' | 'assistant';
    content: string;
    status: FinishedRunStatus;
    result: QuestionResult | null;
    errorCode: string | null;
    sequence?: number;
  }): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      let sequence = input.sequence;
      if (!sequence) {
        const row = await manager
          .createQueryBuilder(MessageEntity, 'message')
          .select('COALESCE(MAX(message.sequence), 0)', 'maxSequence')
          .where('message.analysisId = :analysisId', { analysisId: input.analysisId })
          .getRawOne<{ maxSequence: string | number | null }>();
        sequence = Number(row?.maxSequence ?? 0) + 1;
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
  async recoverStuckAnalyses(cutoff: Date): Promise<void> {
    await this.analyses
      .createQueryBuilder()
      .update(AnalysisEntity)
      .set({
        status: RunStatus.Failed,
        errorCode: PersistenceErrorCode.Interrupted,
        errorMessage: 'The run was interrupted before a result was saved.',
        updatedAt: new Date(),
      })
      .where('status = :status', { status: RunStatus.Processing })
      .andWhere('updated_at < :cutoff', { cutoff })
      .execute();
  }

  /** @inheritdoc */
  async recoverStuckExecutions(cutoff: Date): Promise<void> {
    await this.executions
      .createQueryBuilder()
      .update(AiExecutionEntity)
      .set({ status: RunStatus.Failed, errorCode: PersistenceErrorCode.Interrupted, finishedAt: new Date() })
      .where('status = :status', { status: RunStatus.Processing })
      .andWhere('created_at < :cutoff', { cutoff })
      .execute();
  }

  /** @inheritdoc */
  async insertAudit(input: {
    actorId: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    result: FinishedRunStatus;
    correlationId: string;
  }): Promise<void> {
    await this.auditEvents.insert({
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      result: input.result,
      correlationId: input.correlationId,
    });
  }

  /** @inheritdoc */
  async ping(): Promise<void> {
    await this.dataSource.query('SELECT 1');
  }
}
