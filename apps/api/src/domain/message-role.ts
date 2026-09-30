/** Role of a row in the messages thread. */
export const MessageRole = {
  User: 'user',
  Assistant: 'assistant',
} as const;

export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];
