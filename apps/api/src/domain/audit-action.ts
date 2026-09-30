/** Audit event action names written to audit_events.action. */
export const AuditAction = {
  AnalysisCreate: 'analysis.create',
  QuestionAdd: 'question.add',
  RetentionPurge: 'retention.purge',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Resource type stored on audit_events.resource_type. */
export const AuditResourceType = {
  Analysis: 'analysis',
} as const;

export type AuditResourceType = (typeof AuditResourceType)[keyof typeof AuditResourceType];
