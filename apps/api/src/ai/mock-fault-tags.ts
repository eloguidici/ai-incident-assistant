/** Tags embedded in incident or question text to drive the mock provider. */
export const MockFaultTag = {
  ShouldNotRun: '[MOCK:should-not-run]',
  Timeout: '[MOCK:timeout]',
  Auth: '[MOCK:auth]',
  RateLimit: '[MOCK:429]',
  ServerOnce: '[MOCK:500-once]',
  ServerTwice: '[MOCK:500-twice]',
  Server: '[MOCK:500]',
  InvalidJson: '[MOCK:invalid-json]',
  Schema: '[MOCK:schema]',
  Ungrounded: '[MOCK:ungrounded]',
  DbFailAfter: '[MOCK:db-fail-after]',
} as const;

export type MockFaultTag = (typeof MockFaultTag)[keyof typeof MockFaultTag];
