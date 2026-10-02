/** Closed metadata vocabulary; no user-controlled excerpts belong in these fields. */
export const SECURITY_DETECTOR_VERSION = 'prompt-signals-v1';
export const SECURITY_RULE_IDS = [
  'instruction_override',
  'role_spoofing',
  'prompt_disclosure',
  'secret_exfiltration',
  'evidence_fabrication',
  'delimiter_spoofing',
] as const;
export const SECURITY_INPUT_KINDS = ['incident', 'history', 'question'] as const;
export type SecurityRuleId = (typeof SECURITY_RULE_IDS)[number];
export type SecurityInputKind = (typeof SECURITY_INPUT_KINDS)[number];
