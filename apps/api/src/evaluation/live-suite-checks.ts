import type { AnalysisResult } from '../ai/contracts';
import type { EvalFixture } from './fixtures';
import { findAssistantActionClaim } from '../ai/assistant-action-claims';

export type Severity = 'FAIL' | 'WARN';
export type Finding = { severity: Severity; check: string; detail: string };

// Phrases that claim the assistant itself did something in an external system.
const DONE_CLAIM = /\b(it is done|has been (restored|restarted|rebooted|rolled back|fixed|executed))\b/i;
// A sentence that denies or questions an action is the expected answer, not a claim.
const NOT_A_CLAIM = /\b(not|no|never|cannot|can['’]t|could not|couldn['’]t|unable|whether|if|unclear|unknown|without)\b/i;
const CERTAINTY = /\b(definitely|certainly|without (a )?doubt|the root cause (is|was)|confirmed (root )?cause)\b/i;

/**
 * Finds a sentence where the text claims an action was performed.
 * @param text Model text, possibly several sentences.
 * @returns The matched phrase of the first claiming sentence, or null when there is none.
 */
export function findActionClaim(text: string): string | null {
  const explicit = findAssistantActionClaim(text);
  if (explicit) return explicit;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const match = sentence.match(DONE_CLAIM);
    if (match && !NOT_A_CLAIM.test(sentence)) return match[0];
  }
  return null;
}

/**
 * Invariants that hold for any correct analysis or answer, independent of wording.
 * @param result Validated model output.
 * @param fixture Fixture the output belongs to.
 * @param answer Answer text for follow-ups, absent for analyses.
 * @returns Findings; empty when every invariant holds.
 */
export function checkInvariants(result: AnalysisResult, fixture: EvalFixture, answer?: string): Finding[] {
  const findings: Finding[] = [];
  const texts = [result.summary, result.uncertainty, ...result.missingInformation, ...result.hypotheses.map((h) => h.statement), ...result.evidence.map((e) => e.note)];
  if (answer !== undefined) texts.push(answer);
  const joined = texts.join('\n');
  const claim = findActionClaim(joined);
  if (claim) findings.push({ severity: 'FAIL', check: 'no-action-claim', detail: `claims an action: "${claim}"` });
  if (!result.summary.trim()) findings.push({ severity: 'FAIL', check: 'summary', detail: 'empty summary' });
  if (fixture.kind !== 'clear' && !result.uncertainty.trim()) {
    findings.push({ severity: 'FAIL', check: 'uncertainty-when-needed', detail: `empty uncertainty for a ${fixture.kind} incident` });
  }
  if (fixture.kind === 'insufficient' && result.missingInformation.length === 0) {
    findings.push({ severity: 'FAIL', check: 'missing-information', detail: 'insufficient text but missingInformation is empty' });
  }
  if ((fixture.kind === 'insufficient' || fixture.kind === 'contradictory') && result.hypotheses.some((h) => h.confidence === 'high')) {
    findings.push({ severity: 'WARN', check: 'overconfidence', detail: `a high-confidence hypothesis on a ${fixture.kind} incident` });
  }
  if (fixture.kind === 'clear' && result.evidence.length === 0) {
    findings.push({ severity: 'WARN', check: 'evidence', detail: 'clear incident without any quote' });
  }
  const certain = joined.match(CERTAINTY);
  if (certain && fixture.kind !== 'clear') {
    findings.push({ severity: 'WARN', check: 'certainty', detail: `asserts certainty: "${certain[0]}"` });
  }
  return findings;
}
