import type { AnalysisResult, QuestionResult } from '../ai/contracts';
import type { ExecutionKind } from '../domain/execution-kind';
import type { MessageRole } from '../domain/message-role';
import type { RunStatus } from '../domain/run-status';

/** One LLM execution row exposed on analysis detail. */
export type AnalysisExecutionItem = {
  id: string;
  kind: ExecutionKind;
  status: RunStatus;
  promptVersion: string;
  provider: string;
  model: string;
  attemptCount: number;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
  createdAt: string;
};

/** One message in the analysis thread. */
export type AnalysisMessageItem = {
  id: string;
  role: MessageRole;
  content: string;
  status: RunStatus;
  result: QuestionResult | null;
  errorCode: string | null;
  sequence: number;
  createdAt: string;
};

/** Full analysis detail returned by get/create/retry/question handlers. */
export type AnalysisDetailResult = {
  id: string;
  status: RunStatus;
  sourceText: string;
  /** True when the stored incident matches assistant-instruction patterns. Not a verdict or a block. */
  assistantInstructionsNoted: boolean;
  result: AnalysisResult | null;
  errorCode: string | null;
  errorMessage: string | null;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  messages: AnalysisMessageItem[];
  executions: AnalysisExecutionItem[];
};
