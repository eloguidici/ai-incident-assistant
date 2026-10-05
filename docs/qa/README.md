# Verification evidence

Start with the [2026-10-05 handoff recheck](HANDOFF_RECHECK_2026-10-05.md):
local software regression, rebuilt full-protection stack, two OpenAI analyses,
one follow-up and owner isolation. It retains unsupported inferences; workflow
success is not semantic approval. [Risk decisions](../security/AI_RISK_DECISIONS.md)
define the synthetic, human-reviewed demonstration boundary.

## Reproduce current checks

Use the root [verification commands](../../README.md#verification) and
[manual procedure](MANUAL_ACCEPTANCE.md). The [UI workflows](UI_FLOWS.md),
[regression catalog](REGRESSION_CATALOG.md) and [evaluation guide](AI_EVALUATION.md)
describe expectations. Commands are procedures, not new executed results.
Keep test data isolated; paid model calls require intentional execution.

## Historical reports

Read each report's date, prompt/model and runtime profile. Files stay at their
original paths for stable links and reproducibility. Historical FAIL/NO-GO
outcomes remain unchanged, not relabeled as current release approval.

| Report | Recorded scope |
|---|---|
| [Installation and delivery verification, 2026-10-04](DELIVERY_VERIFICATION.md) | Separate-checkout installation, software checks and real-PII browser/modes. |
| [Recorded demo samples](DEMO_CASES.md) | v7/v9 provider samples, generic-answer and PII false-positive limits; not full current regression. |
| [Assessment closure, 2026-10-03](ASSESSMENT_CLOSURE.md) | v6/v7 provider review and correction; semantic quality FAIL remains. |
| [Local detector integration](LOCAL_PII_INTEGRATION.md) | Resource/integration/quality evidence, including accepted partial-name failure. |
| [Presidio/spaCy feasibility](PII_SPIKE.md) | NO-GO experiment; not the current detector. |
| [Initial injection QA](PROMPT_INJECTION_QA.md), [Liquid live](PROMPT_SECURITY_LIVE.md), [GPT live](PROMPT_SECURITY_GPT.md), [remediation checkpoint](PROMPT_SECURITY_REMEDIATION.md) | Earlier prompt boundaries, failures and remediation; not current-model immunity. |
| [Live quality suite](LIVE_SUITE.md), [browser snapshot](BROWSER_CASES.md) | Reproducible procedures and dated runs. |
| [Assessment review, 2026-10-02](../requirements/ASSESSMENT_REVIEW_2026-10-02.md) | Earlier review before the local detector integration. |

## Experiments and evaluation tooling

The application detector is [services/pii](../../services/pii/README.md).
Evaluation code is not another application service or a prerequisite for startup.

| Directory | Purpose |
|---|---|
| [qa/pii-spike](../../qa/pii-spike/README.md) | Historical Presidio/spaCy feasibility prototype; not integrated into the application. |
| [qa/pii-comparison](../../qa/pii-comparison/README.md) | GLiNER calibration, holdouts, performance measurements and runtime probes; evaluation tooling, not the HTTP service. |
| [qa/e2e/pii](../../qa/e2e/pii/README.md) | Protected browser and mode checks. |
| `qa/e2e/`, `qa/docker/`, `qa/fixtures/` | Application regression, proxy checks and synthetic fixtures. |

These files remain in place because existing runners reuse them. Public summaries
are self-contained; local raw outputs/traces, credentials and model caches are
excluded from the submitted repository. Do not use confidential real data in QA.
