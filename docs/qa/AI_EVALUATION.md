# AI Evaluation And Reliability

Updated: 2026-10-04, America/Buenos_Aires. Section 2.2 is closed as an explanation of output quality, regressions and wrong answers in production. The PDF permits a short Markdown section, not a complete evaluation system. This does not semantically approve current prompts or relabel historical failures.

## 1. Measuring Output Quality

T26: [cases by route/model and factual review candidates](../security/AI_RISK_DECISIONS.md). Uncertainty failed on both routes even after stronger prompts; causes were not experimentally isolated. A second LLM or managed check remains proposed, not an executed evaluation.

Separate software correctness from model usefulness. A report can be valid JSON with exact quotes while suggesting an incorrect cause. Contract approval is not diagnostic accuracy.

Software checks schema, exact quotes, complete URLs and a bounded lexical rule for impossible external assistant actions. The [rubric](../../apps/api/src/evaluation/rubric.ts) and [five synthetic fixtures](../../apps/api/src/evaluation/fixtures.ts) score summaries, evidence/uncertainty and URL controls. Its injection check looks for an English no-external-action phrase: it is a heuristic, not a semantic judge. The [validator's](../../apps/api/src/ai/validate.ts) separate action rule is also not universal truth verification.

In the current tree, a nonexact quote or one cutting a PII token is omitted rather than automatically rejecting the whole result. A caveat/missing-information item is added when those fields were empty; both are required without evidence. Foreign URLs, invalid schemas and selected external-action claims still reject output; questions additionally check recognized contact values absent from the source. Sanitizer-introduced labels are allowed, not unknown model-invented labels. These policies do not certify the remaining text.

Another lexical rule moves a summary/answer/hypothesis sentence to uncertainty when it contains one of seven English expressions (`attributed to`, `triggered by`, `caused by`, `due to`, `led to`, `rules out`, `confirms`) absent from the entire source. It does not verify the factual relationship or cover all phrasings/languages; it may remove useful facts or allow false causes. Moved sentences are not automatically rephrased as possibilities; uncertainty is capped at 1,000 characters and an emptied answer gets a generic sentence. This is not another LLM or a semantic judge.

On 2026-10-03 the weak rubric URL check was corrected: a source containing one URL no longer authorizes arbitrary output links. Evaluation reuses runtime extraction, compares complete lexemes across every analysis narrative field and preserves prose punctuation/balanced parentheses. A source with `https://status.example.test/report` does not authorize `https://foreign.example.test/report`. This checks textual presence, not whether a link is true, trusted or safe; no URL is fetched.

Use representative cases with expected facts: clear, insufficient and contradictory incidents, legitimate quoted attacks, injection attempts and conversation follow-ups. A human reviewer would inspect **all** responses, including rejected ones, for faithful summary/classification, useful hypotheses, proportionate confidence and no invented actions/authority. Repeat cases to observe variation; no additional judge or statistical product-accuracy measurement is implemented.

| Proposed measure | Observation | Boundary |
|---|---|---|
| Schema/URL failures and omitted quotes across all attempts | Compatibility, contract errors and lost supporting evidence | Quote omission changes acceptance, not demonstrated semantic improvement |
| Human review of grounded answers, uncertainty and false claims | Usefulness and factual fidelity | Needs reference facts/criteria and representative samples; not universally automated |
| Legitimate false rejections and accepted attacks | Defense effects | Small samples do not guarantee security |
| Latency, attempts, tokens and estimated cost | Operational feasibility | No automatic quality dashboard/alerts or certified invoice; timeouts can be charged |

Provider/model/version/attempt/latency/available-token metadata is already stored. This describes its proposed use, not a deployed dashboard. Local sanitation and misses are measured separately in [T22](LOCAL_PII_INTEGRATION.md).

## 2. Detecting Prompt Or Model Regressions

Compare the same cases and criteria before/after a change, not one attractive example. Record provider/model, prompt version, limits/deadlines and protection mode; preserve legitimate controls and attacks without weakening them after failures. Compare contract acceptance/rejection, human review, confidence, latency and tokens. Different per-provider matrices cannot establish a rigorous provider ranking.

Current prompts are `incident-analysis.v7` and `incident-question.v9`, versioned in [code](../../apps/api/src/ai/contracts.ts). `npm run test:unit` and `npm run qa:eval` offer reproducible unpaid regression. The [defined CI](../../.github/workflows/ci.yml) runs contracts/mock evaluation, not paid requests or semantic certification. `qa:ai:live` uses a real provider; the [live suite](../../apps/api/src/evaluation/live-suite.ts) and [advanced cases](../../qa/fixtures/prompt-security-advanced.json) support additional workflows/review within a bounded budget.

Before approving a changed version's quality, rerun affected software checks and a comparable real sample. Historical [Liquid](PROMPT_SECURITY_LIVE.md) and [GPT](PROMPT_SECURITY_GPT.md) FAIL outcomes remain. [Local remediation](PROMPT_SECURITY_REMEDIATION.md) and this rubric fix are not a new LLM result. T25 executed 57 real before/after attempts through OpenAI/OpenRouter. Its historical v6/v7 semantic quality remains FAIL: unsupported inferences and one GPT-4.1-mini injection were accepted. See [evidence and limits](ASSESSMENT_CLOSURE.md). T20 is not closed as quality approved.

### Later Recorded Samples, v7/v9

The [A1–A5, B1–B7 and C records](DEMO_CASES.md) report 13 completed analyses through OpenAI `gpt-4o-mini-2024-07-18` and 13 through OpenRouter `openai/gpt-4o-mini`, with no observed compliance with the reviewed injections. A4 retains a generic visible answer while important facts remain in collapsed detail; PII false positives remain. The Liquid pass records 429, timeout and action/schema rejections. These route samples do not establish statistical accuracy or immunity.

Prompts and post-processing changed, including quote filtering: do not attribute more accepted results solely to the model. Where authorized synthetic artifacts exist, compare raw versus displayed output, omitted evidence, information loss and usefulness with human review. Do not copy real data to logs. This documentation update does not repeat those runs, certify full current regression or verify remote CI.

## 3. Responding To Wrong Answers In Production

Distinguish a technical failure from an incorrect answer that passed its contract. Invalid JSON/schema or foreign URLs are rejected; a nonexistent quote is omitted and the result may survive remaining checks. A plausible but false hypothesis needs factual review; an analyst should not treat it as a resolved incident.

Implemented controls show evidence/uncertainty/confidence, reject invalid output and retain investigative metadata. A failed question preserves an earlier valid analysis. There are no remediation tools or guaranteed records during database outages. Output rejection does not undo a provider call or its possible charge.

The proposed production procedure is:

1. Do not use the disputed conclusion as an automatic decision; review the case/impact with a human owner.
2. Locate execution/model/version/correlation and collect only necessary evidence with privacy controls, not confidential payloads in logs.
3. Diagnose integration/contract error, prompt/model regression or insufficient evidence; add a synthetic or authorized regression case.
4. Roll back a harmful change under controlled deployment and retest before reuse. Provider/model comes from environment and requires process restart/recreation; prompt rollback requires the corresponding code revision and deployment. There is no variable selecting any historical prompt or database prompt editor.
5. Review potentially affected executions using available metadata and verify that legitimate cases still work.

Feedback buttons, curated production-failure collection, semantic alerts, version experiments and automatic rollback are not implemented. They are operational evolution, not missing 2.2 requirements or promised current functionality.

## Historical T24 Closure Verification

Pre-fix reproduction returned PASS for a foreign URL where FAIL was expected. After correction: [30 new tests](../../apps/api/test/evaluation-rubric.unit.spec.ts) PASS; unit regression 174 PASS/one optional actual-detector test skipped without a URL; mock evaluation 5/5; API typecheck/lint/build PASS. The skip does not certify the detector or replace its known FAIL. These are offline results, not new real-model approval, remote CI or deployment. Advanced cases and synthetic-demo PII acceptance remain unchanged.
