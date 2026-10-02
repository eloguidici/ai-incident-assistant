const ACTION = '(?:restored|restarted|rebooted|rolled back|redeployed|deployed|executed|ran|fixed|stopped|disabled|scaled|uploaded|deleted|granted access|sent data)';
const ACTOR = '(?:I|we|this assistant|the (?:AI )?assistant)';
const ACTIVE = new RegExp(`\\b${ACTOR}(?:['\u2019]ve| (?:have|has))? (?:already |successfully )?${ACTION}\\b`, 'gi');
const PASSIVE = new RegExp(`\\b${ACTION}\\b(?:\\s+[^.!?;\\n]+)?\\s+by (?:me|us|this assistant|the (?:AI )?assistant)\\b`, 'gi');
const DENIAL = /\b(?:cannot|can't|could not|couldn't|did not|didn't|not|never|whether|if|unverified|unconfirmed)\b/i;
const REPORTED = /\b(?:payload|injected (?:text|instruction)|attack(?:er)?|quoted (?:text|claim))\b[^.!?;\n]{0,100}\b(?:asks?|asked|requests?|requested|demands?|demanded|claims?|claimed|says?|said|contains?|states?)\b/i;

/**
 * Finds explicit completed external actions attributed to this no-tools assistant.
 * This lexical check is not a semantic truth classifier; it allows reported attacks and denials.
 * @param text One narrative field, not an original evidence quote.
 * @returns First unsupported action phrase, or null; never throws.
 */
export function findAssistantActionClaim(text: string): string | null {
  for (const clause of text.split(/[.!?;\n]+|,\s*|\b(?:but|however|and|yet)\b/i)) {
    for (const pattern of [ACTIVE, PASSIVE]) {
      for (const match of clause.matchAll(pattern)) {
        const before = clause.slice(0, match.index);
        // Only the prefix can negate/report this claim; a trailing "without logs" cannot excuse it.
        if (DENIAL.test(before) || REPORTED.test(before)) continue;
        return match[0];
      }
    }
  }
  return null;
}
