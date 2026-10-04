import { incidentNotesAssistantInstructions } from '../ai/prompt-injection-signals';
import type { AnalysisRepository } from '../db/repositories/analysis.repository';
import type { AnalysisDetailResult } from './analysis-detail.types';

/** Maps a repository detail load into the public API shape. */
export function mapAnalysisDetail(loaded: NonNullable<Awaited<ReturnType<AnalysisRepository['loadDetail']>>>): AnalysisDetailResult {
  const { analysis: row, messages: thread, executions } = loaded;
  return {
    id: row.id,
    status: row.status,
    sourceText: row.sourceText,
    assistantInstructionsNoted: incidentNotesAssistantInstructions(row.sourceText),
    result: row.result ?? null,
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
      result: message.result ?? null,
      errorCode: message.errorCode,
      sequence: message.sequence,
      createdAt: message.createdAt.toISOString(),
    })),
    executions: executions.map((execution) => ({
      id: execution.id,
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
