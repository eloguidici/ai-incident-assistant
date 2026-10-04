import type { SecurityRuleId } from '../common/constants/security-signal';

// Fixed, bounded patterns: these are observable signals, not an authorization decision.
const RULES: ReadonlyArray<{ id: SecurityRuleId; pattern: RegExp }> = [
  { id: 'instruction_override', pattern: /\b(?:ignore|disregard|override|forget|ignora|ignore|ignorar|omite|olvida)\b.{0,80}\b(?:instructions?|rules?|prompt|instrucciones|reglas)\b/u },
  { id: 'role_spoofing', pattern: /(?:<\|(?:im_start|start_header_id)\|>\s*(?:system|developer)|\[\s*(?:system|developer)\s*\]|"role"\s*:\s*"(?:system|developer)"|\b(?:you are now|act as|ahora eres|actua como)\s+(?:the\s+)?(?:system|developer|administrator|sistema|administrador)\b)/u },
  { id: 'prompt_disclosure', pattern: /\b(?:reveal|print|show|repeat|dump|muestra|revela|imprime)\b.{0,80}\b(?:system prompt|developer message|hidden instructions|prompt del sistema|instrucciones internas)\b/u },
  { id: 'secret_exfiltration', pattern: /\b(?:send|upload|post|transmit|exfiltrate|envia|enviar|manda|sube)\b.{0,120}\b(?:api[ _-]?keys?|tokens?|secrets?|credentials?|passwords?|claves?|secretos?|credenciales|contrasenas)\b/u },
  { id: 'evidence_fabrication', pattern: /\b(?:invent|fabricate|forge|inventa|inventar|fabrica|fabricar|falsifica)\b.{0,80}\b(?:evidence|quotes?|citations?|evidencia|citas?|pruebas)\b/u },
  { id: 'delimiter_spoofing', pattern: /(?:<<<\s*(?:incident|question|conversation)\b|\b(?:incident|question|conversation)\s+id\s*=.{0,80}>>>)/u },
];

/**
 * Reports whether stored incident text matches a known assistant-instruction pattern.
 * @param sourceText Incident text already stored for the analyst. The scan does not change it.
 * @returns True when at least one rule matches. False is not proof the text is safe.
 * @remarks Observation only. It does not block analysis, score confidence, or judge the result.
 */
export function incidentNotesAssistantInstructions(sourceText: string): boolean {
  return detectPromptInjectionSignals(sourceText).length > 0;
}

/**
 * Observes known instruction-like patterns in raw data, never in our own system prompt.
 * @param text Raw incident, selected conversation, or question. HTTP/context limits bound production inputs.
 * @returns Deduplicated rule identifiers in stable order. No match means no known signal, not safe input.
 * @remarks Normalization affects a scan-only copy; original quotes and model input remain unchanged.
 * No external calls, blocking, rewriting, semantic validation, or confidence score. Throws no contract errors.
 */
export function detectPromptInjectionSignals(text: string): SecurityRuleId[] {
  const scanText = text.normalize('NFKC').normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ')
    .toLowerCase();
  return RULES.filter(({ pattern }) => pattern.test(scanText)).map(({ id }) => id);
}
