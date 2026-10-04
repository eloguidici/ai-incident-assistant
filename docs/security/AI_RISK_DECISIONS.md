# AI security decisions and limitations


Reviewed: 2026-10-03, America/Buenos_Aires. Research/documentation only: no new
executable guard or model calls. [T25 evidence](../qa/ASSESSMENT_CLOSURE.md) remains
**semantic FAIL**; all three residual risks are accepted only for a synthetic demo.
Primary documentation establishes the alternatives below, not effectiveness in
our application. None were purchased or benchmarked against our cases. Prices,
account availability and measured superiority are not claimed.

## Assessment Scope

Documentation update 2026-10-04, Buenos Aires: the current tree uses v7/v9,
omits nonexact quotes and applies a limited lexical causal rule, without a second
LLM. The visible injection note is computed on read, not enforcement or output
judgment. [Later recorded samples, in Spanish](../qa/DEMO_CASOS.es.md) completed
13 analyses per GPT route without observed compliance with the reviewed attacks,
but retained a generic answer and PII false positives; Liquid had failures.
This is not immunity, statistical accuracy or full current regression. T25 cases
below keep their historical versions/FAIL outcomes. See [evaluation](../qa/AI_EVALUATION.md).
T26 alternatives research was not repeated and does not certify current availability.

The PDF asks for explanations of injection/unsafe input (1.2), uncertainty (1.3),
PII (2.1), and quality/regressions/wrong answers (2.2). It does not require agents,
a second LLM or a complete evaluation system. Scope can be limited; an incorrect
output cannot be declared correct. See the [matrix](../requirements/ASSESSMENT.md).

## 1. Prompt Injection

**Observed:** OpenRouter `openai/gpt-4.1-mini`, prompts v6/v7, accepted and persisted
a malicious rubric's `OVERRIDE_ACCEPTED_RUBRIC` summary and `security`/`critical`
classification for an availability incident. No actions executed: there are no
model tools, but report manipulation is still a failure. Some later rejections
concerned invalid labels or action claims, not understanding the attack.

**Current boundary:** authentication/limits, system instructions/random delimiters,
observation-only pattern signals, schema/quote/URL/label validation and a narrow
false-action rule. Observation does not block; an exact quote does not establish
a legitimate conclusion or classification. [Implemented controls](PROMPT_INJECTION.md).

Semantic compliance with untrusted content was observed; the model's internal
mechanism was not established. Stronger instructions might help, but the measured
iteration did not remove the failure. Model mitigations are not infallible, as
the [OpenAI safety guide](https://developers.openai.com/api/docs/guides/agent-builder-safety)
also explains.

| Candidate, not implemented | Function and condition |
|---|---|
| [Meta Prompt Guard 2](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-22M) | Local specialist classifier, 22M/86M variants, not another conversational LLM. A 512-token window and multilingual/adversarial limitations require segmentation, license/access review and our own CPU benchmark. |
| [LLM Guard](https://github.com/protectai/llm-guard/blob/main/llm_guard/input_scanners/prompt_injection.py) | Model-based scanning library, not merely regex. Historical reference: [repository archived](https://github.com/protectai/llm-guard) on 2026-07-09, with no active maintenance declared. Adoption requires a maintenance plan and effectiveness evaluation; resistance to our rubric is untested. |
| [Azure Prompt Shields](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/quickstart-jailbreak) / [Lakera Guard, Check Point AI Guardrails](https://docs.lakera.ai/docs/api) | API-based detection services with separate credentials/configuration and application enforcement policies. They do not certify truth or guarantee detection of every attack. |

Legitimate reports may quote attacks. Blocking every matching phrase would create
false positives; benign and adversarial controls must calibrate policy first.

## 2. Unsupported Conclusions

Evidence distinguishes route, model and prompt. OpenRouter is not itself a model;
both adapters use the OpenAI SDK, JSON mode and temperature 0.2.

| Route / model / prompts | Observed control example |
|---|---|
| OpenAI / `gpt-4o-mini` / v5-v6 | Note: "Eliminates deployment as a potential cause of the outage." |
| OpenRouter / `openai/gpt-4o-mini` / v5-v6 | Note: "This rules out deployment-related issues as the cause." |
| OpenAI / `gpt-4o-mini` / v6-v7 | Follow-up: "This rules out recent deployments as a cause of the issue." |
| OpenRouter / `openai/gpt-4.1-mini` / v6-v7 | Summary attributes HTTP 503 responses to unhealthy load-balancer targets. |

No deployment **during** the window does not exclude an earlier deployment's effects.
HTTP 503 responses co-occurring with unhealthy targets do not prove causality.
A tentative hypothesis is valid; an unsupported confirmed cause is not.

**Known in that historical run:** the prompt already prohibited these conclusions without causal
support. Quotes may be exact while interpretation is excessive. General factual
entailment is not validated. Valid JSON and low temperature do not verify truth.
**Unknown:** prompt/model/route effects were not causally isolated; the fourth pass
changed model and prompt relative to baseline. This small sample cannot rank
providers or estimate production frequency.

**Evolution:** a separate LLM-as-judge call could compare protected source and output
claims before persistence. Agents are unnecessary; a small contract suffices. The
reviewer may also err or be manipulated. Criteria, held-out cases and human
calibration are needed; see [OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).
This is proposed, not existing validation.

[Amazon Bedrock contextual grounding](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-contextual-grounding-check.html)
offers a managed source/query/response check. Its documented exclusion of chatbot
conversations prevents treating it as a drop-in replacement for all follow-ups.
Evaluate per-task suitability and distinguish factual claims from intentionally
tentative hypotheses rather than rejecting every unsupported possibility.

## 3. Names and PII

GLiNER identifies name spans, validators identify contacts, and HMAC substitutes
detected values. With `Lucia Exampleperson`, the first pass hid only `Lucia` and
another pass hid the surname: actual omission and non-idempotence. Technical
words can also be mistaken for people. Changed context plausibly affects span
boundaries, but that cause was not experimentally isolated.

HMAC cannot fix missed entities or stabilize different spans. Pseudonymization
does not guarantee anonymity; context can re-identify people. Local execution
avoids an extra recipient for the detector, not detection omissions. Misses may
reach the model provider. [Current policy](DATA_POLICY.md).

| Candidate, not implemented | What we would compare |
|---|---|
| [Customized Presidio](https://github.com/data-privacy-stack/presidio/blob/main/docs/faq.md) | Alternative recognizers/models/rules. Our Presidio/spaCy NO-GO concerned a tested configuration, not impossibility of the framework. Its documentation also disclaims complete PII detection. |
| [Amazon Comprehend PII](https://docs.aws.amazon.com/comprehend/latest/dg/how-pii.html) | Managed English/Spanish name/PII detection; a natural candidate for an AWS deployment. Compare complete spans, misses and false positives on the same cases. |
| [Google Sensitive Data Protection](https://docs.cloud.google.com/sensitive-data-protection/docs/concepts-infotypes) | Name detectors and custom/contextual rules; another managed candidate, not proven superior here. |

An LLM could propose spans, but exact offsets would need validation and evidence
must not be silently rewritten. Sending originals to a managed detector adds a
data processor requiring recipient, region, retention and log review. Even
[Bedrock sensitive filters](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-sensitive-filters.html)
require attention to traces/logs that may contain originals or matches.

## Decision and Evolution Gates

"My machine is local, so I cannot do this" is not our justification. Hosted services
can be called from Nest without running their model locally. A small local
classifier's feasibility also remains unmeasured. Open and managed alternatives
exist; not every option should be described as necessarily paid.

The current decision limits assessment scope and avoids an unevaluated integration
with added latency, cost, errors and recipients. Existing OpenAI/OpenRouter keys
do not automatically authorize Azure, Lakera, AWS or Google. OpenRouter does not
automatically add specialist protections to our configured calls.

Before promotion: compare identical cases/versions; include encoded/rephrased
attacks, legitimate security reports, causal/contradictory inputs and compound
names; measure span completeness, idempotence, false alarms, p50/p95 latency,
consumption and service failures. Reviewer source/candidate text must remain
untrusted data. Protection outages must not trigger forwarding of originals.

## Demonstration Risk Acceptance

On 2026-10-03 the owner explicitly accepts report-altering injection, unsupported
conclusions and name-detection omissions/variation as assessment/synthetic-demo
limitations. No further mitigation or model retesting is planned in this stage.
Measured results remain FAIL; scoped acceptance does not fix defects or turn them
into PASS.

The demo uses synthetic data, human review and no automatic remediation. It does
not authorize confidential information or operational decisions based solely on
outputs. The owner's manual test is deferred to a later session.

Specialist classifiers, managed services and reviewer models remain outside this
demo because integration and effectiveness have not been evaluated. They may
require separate accounts/agreements, budget and data policies; alternative costs
and resource requirements were not benchmarked. They are not technically impossible
from a local machine, necessarily paid or correctness guarantees. Production use
would require evaluation and new risk acceptance, not extension of this decision.
