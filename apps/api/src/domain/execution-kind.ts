/** Kind of AI execution row stored in ai_executions.kind. */
export const ExecutionKind = {
  Analysis: 'analysis',
  Question: 'question',
} as const;

export type ExecutionKind = (typeof ExecutionKind)[keyof typeof ExecutionKind];
