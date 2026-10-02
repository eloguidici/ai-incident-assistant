# Prompt-injection signals


## Current behavior

Remediation checkpoint, 2026-10-02: current prompts are v4/v5, with explicit rubric/encoded-authority/history and causal-confidence rules. The output validator now compares complete URL lexemes while ignoring prose punctuation, and rejects selected explicit external actions attributed to the assistant (including passive restoration). It preserves denials, reported attacks and original evidence quotes. This lexical control is not a general truth classifier; the input scanner remains observation-only. [Checkpoint and pending live verification](../qa/PROMPT_SECURITY_REMEDIATION.md).

The assessment section 1.2 asks for an explanation of unsafe input and prompt injection; it does not mandate a scanner, library, second model, or agents. The application adds a small native TypeScript `RegExp` observer to its existing data/instruction separation, input limits, no-tools policy, output validation and human review. It is not a security verdict or a blocking guardrail.

`detectPromptInjectionSignals` in [the detector](../../apps/api/src/ai/prompt-injection-signals.ts) scans a normalized copy (Unicode compatibility, accents, selected zero-width characters, whitespace, case). Original source, exact quotes, persisted messages and source content sent to the provider remain unchanged. Six closed identifiers cover instruction overrides, role spoofing, prompt disclosure, secret exfiltration, fabricated evidence and forged delimiters. No external service, extra model call, dependency, schema field, API/UI response or confidence score is added. Detector changes require review, versioning and regression; its version is independent of the current v4/v5 prompts.

## Use cases and data flow

1. Create or retry: authenticate, validate and reserve as before; observe the raw incident before the model invocation. Retrying observes it again for the new request, not on every gateway retry.
2. Follow-up: enforce ownership, quotas and context budget; observe the original incident, selected history and new question before invoking the model. Both prior user and assistant content are untrusted data. Failed exchanges, dropped messages and characters beyond the existing 1,000-character history truncation are not scanned because they are not sent to the model.
3. Incident describing an attack: a quoted malicious instruction can emit a signal and still be analyzed. It is not rejected, erased or given a different prompt.
4. Signal plus bad output: the usual schema/quote/URL validator rejects invalid model output; observation cannot bypass it. A failed question preserves the prior valid analysis.
5. No signal: continue normally; this does not establish that the input is safe. Encoded or semantic attacks can evade the patterns.
6. Invalid input or unauthorized request: existing checks reject before observation/model invocation. A logging transport failure cannot turn observation into blocking.

Logs emit at most six events per input block (18 across a question's three blocks), deduplicated per rule/block. `prompt_injection_signal` contains `analysisId`, validated or generated `correlationId`, `securityDetector`, `securityRule` and `securityInput`, not matched excerpts, hashes, offsets or a copy of the input. The three security fields are restricted to closed values by the [log redactor](../../apps/api/src/common/log.ts). See the [data policy](DATA_POLICY.md) and [runbook](../operations/RUNBOOK.md); console logs are not immutable security audit rows or an automatically monitored alert system.

## Reproducible checks and limits

New local execution evidence: [2026-10-02 QA results](../qa/PROMPT_INJECTION_QA.md), including full regression and two adversarial browser cases on the actual nginx/API/PostgreSQL stack with a mock model.

Run `npm run qa:security:signals` against `incident_assistant_test` using the normal test environment. It includes delimiter/prompt construction checks, 27 signal fixtures (21 attacks, four ordinary inputs, two legitimate quoted attack reports), six deliberately declared evasions, metadata/privacy checks, and nine API/PostgreSQL scenarios with a mock model. These verify software behavior, not model resistance. Full regression uses `npm run test:coverage`, `npm run test:web`, `npm run qa:eval` and browser suites. Paid real-provider evaluation is separate and requires approval; historical live evidence is not a new certification of this change.

Known misses include base64, HTML entities, Cyrillic homoglyphs, long gaps and semantic paraphrases/output manipulation. Rules cover selected English/Spanish forms, not all languages or obfuscations. A match on a quoted attack is expected; it illustrates why automatic blocking is not enabled. A passing test asserting a miss is documentation of that limit, not successful detection. No statistically meaningful sensitivity, false-positive rate or semantic-accuracy claim is made from this curated set. The application still sends original text to the configured model; it does not redact personal data or prevent exfiltration merely by logging an exfiltration signal.

The subsequent authorized [live evaluation on the configured model](../qa/PROMPT_SECURITY_LIVE.md), 2026-10-02, **FAILED**: rubric-pressure injection changed an accepted summary/classification and led to a fabricated restoration claim. The observer emitted no signal for that attack; schema/exact quotes did not reject it. A legitimate quoted report also exposed punctuation-sensitive URL rejection. These are measured defects, not merely hypothetical limits; no second model was added.

## Future options, not implemented

The subsequent [paid GPT comparison](../qa/PROMPT_SECURITY_GPT.md) also exposed instruction-following in the raw rubric answer and accepted attachment-authorization claims. Rejection of one malicious response depended on missing quotes/uncertainty, not semantic detection; a clearly labeled offline variant with one valid quote passed. Model selection alone has not resolved the measured problem. Shared budget exhausted at 15; no guard was evaluated.

A dedicated local classifier can broaden detection without a generative LLM, but introduces weights/runtime, latency and threshold calibration. An independent LLM reviewer could classify the input or compare an answer with authorized evidence; it adds cost, latency, data exposure and its own susceptibility to injection and judgment errors. An agent can orchestrate those steps but is not itself a guarantee or a necessary dependency. Any future enforcement needs measured false positives/negatives, adversarial model tests, timeout/fail-open or fail-closed policy, and server-side authorization for every tool. A second opinion remains evidence for review, not proof of truth. This assessment currently prioritizes the smaller observable layer and preserves the no-tools boundary.
