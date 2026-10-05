# Documentation

Start with the root [README](../README.md) to run and evaluate the application,
then the [latest handoff verification](qa/HANDOFF_RECHECK_2026-10-05.md).
This index maps assessment explanations; the [evidence index](qa/README.md)
separates final checks, historical reports and experiments.

Delivery documentation is English-only and self-contained. Repository documents
are not served by the application.

## Required assessment documentation

| Requested explanation | Canonical documentation |
|---|---|
| README: architecture decisions | [Rationale](architecture/RATIONALE.md), [design](architecture/DESIGN.md) |
| README: AI design choices | Root README, [MVP contracts](features/MVP.md), [prompt boundaries](security/PROMPT_INJECTION.md) |
| README: trade-offs and known limitations | Root README, [AI risk decisions](security/AI_RISK_DECISIONS.md) |
| README: clear local run instructions | Root README, [runbook](operations/RUNBOOK.md), [manual procedure](qa/MANUAL_ACCEPTANCE.md) |
| 1.1: chosen use case and simplifications | [Product scope](business/PRODUCT.md), root README |
| 1.2: input safety, production costs/rate limits | Root README, [prompt-injection controls](security/PROMPT_INJECTION.md) |
| 1.3: React pages, states, refinement/uncertainty | [UI workflows](qa/UI_FLOWS.md), root README |
| 2.1: stored/nonstored data, retention, PII, logs/audit | [Data policy](security/DATA_POLICY.md) |
| 2.2: quality, regressions, wrong production answers | [Evaluation and reliability](qa/AI_EVALUATION.md) |
| 3.1: IaC, keys, rotation, config/code, bursty usage | [Terraform guide](../infra/terraform/README.md), runbook |
| 3.2: optional Docker/deployment/scaling explanation | Root README, Terraform guide, `infra/docker/` |
| Coverage and optional items | [Requirements matrix](requirements/ASSESSMENT.md) |

The matrix maps requirements; it is not a new test certification. AWS is a defined, undeployed proposal, which the assessment permits. RAG, streaming, tools and durable queues are not mandatory and are not implemented.

## Current implementation and preparation

- [Local PII guide](security/PII_IMPLEMENTATION_PLAN.md): current code/configuration and failure boundaries. Database/prompt use HMAC tokens; React shows short colored Person/Email/Phone labels, without restoring originals.
- [AI risk decisions](security/AI_RISK_DECISIONS.md): accepted synthetic-demo limits for injection, unsupported conclusions and partial names; researched alternatives are not implemented or effectiveness-certified.
- [Manual acceptance procedure](qa/MANUAL_ACCEPTANCE.md): reproducible 4,000/500 script profile, exercised in the 2026-10-05 handoff. The [runbook profiles](operations/RUNBOOK.md#configuration-profiles) distinguish it from 1,000/500 base defaults and the historical 8,000/1,000 expanded demo.
- [Delivery checklist](operations/DELIVERY_CHECKLIST.md): local review steps, recorded acceptance and final access/CI checks. No production approval is implied.

Decision records: [ADR-001 stack](decisions/ADR-001-stack.md), [ADR-003 session](decisions/ADR-003-session.md), [ADR-004 model](decisions/ADR-004-model.md), [ADR-005 AWS proposal](decisions/ADR-005-aws.md), [ADR-006 TypeORM](decisions/ADR-006-typeorm-repository.md), [ADR-007 local PII](decisions/ADR-007-local-pii.md). [ADR-002 persistence](decisions/ADR-002-persistence.md) is superseded history.

## Recorded evidence and historical material

The [verification evidence index](qa/README.md) lists reports by scope, with the
2026-10-05 handoff first. Historical reports remain at their original paths with
dates, prompt/model, profile and FAIL/NO-GO preserved. A completed request or an
earlier PASS is not full semantic approval of the submitted revision.

The same index distinguishes the current detector from the Presidio/spaCy
prototype and GLiNER evaluation utilities. Synthetic fixtures and runners remain
available for reproducibility; they are not extra application services.

## Local-only material and runtime boundary

Secrets, database exports, raw QA artifacts, traces, caches and generated builds
are excluded from the submitted files. Public explanations and reports do not
require access to those artifacts.

`docs/` is excluded from runtime images; the frontend publishes only its build.
`npm run check:web-docs` checks that build, not every possible credential leak.
