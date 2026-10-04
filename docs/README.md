# Documentation

Start with the root [README](../README.md) to run and evaluate the application. This index separates current explanations from dated evidence; files are kept in their existing locations. Repository documentation is not served by the application.

Delivery documentation is English-only. Personal translations and interview
study material are local and excluded from the submitted checkout; public
explanations and dated failure summaries remain self-contained.

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
- [Manual acceptance procedure](qa/MANUAL_ACCEPTANCE.md): reproducible 4,000/500 script profile. The [runbook profiles](operations/RUNBOOK.md#configuration-profiles) distinguish it from 1,000/500 base defaults and the last recorded 8,000/1,000 demo.
- [Delivery checklist and publication policy](operations/DELIVERY_CHECKLIST.md): what travels in Git, what stays local and what must be verified before submission. No commit/push or production approval is implied.

Decision records: [ADR-001 stack](decisions/ADR-001-stack.md), [ADR-003 session](decisions/ADR-003-session.md), [ADR-004 model](decisions/ADR-004-model.md), [ADR-005 AWS proposal](decisions/ADR-005-aws.md), [ADR-006 TypeORM](decisions/ADR-006-typeorm-repository.md), [ADR-007 local PII](decisions/ADR-007-local-pii.md). [ADR-002 persistence](decisions/ADR-002-persistence.md) is superseded history.

## Recorded evidence and historical material

Read each report's date, prompt/model and runtime profile. A previous PASS/FAIL or completed request is not a full regression of the submitted revision. Historical failures remain public.

| Evidence | Scope |
|---|---|
| [Local delivery verification, 2026-10-04](qa/DELIVERY_VERIFICATION.md) | Current uncommitted corrections: clean-checkout installation, software regression, real-PII browser/modes and Docker checks. Remote CI/manual acceptance and accepted AI limits remain separate. |
| [Recent demo cases](qa/DEMO_CASES.md) | English summary of recorded v7/v9 GPT samples: 13 analyses completed on each route; generic answer/PII false positives and earlier failures remain. Not a complete current regression. |
| [T25 assessment closure](qa/ASSESSMENT_CLOSURE.md) | Historical v6/v7 real-provider pass, one correction and retained semantic FAIL. Not the current release gate. |
| [T22 PII integration](qa/LOCAL_PII_INTEGRATION.md) | Dated integration/resource/quality evidence and accepted partial-name failure. |
| [T21 PII spike](qa/PII_SPIKE.md) | Original Presidio/spaCy experiment: NO-GO, not the runtime. |
| [Initial injection QA](qa/PROMPT_INJECTION_QA.md), [Liquid live](qa/PROMPT_SECURITY_LIVE.md), [GPT live](qa/PROMPT_SECURITY_GPT.md), [remediation checkpoint](qa/PROMPT_SECURITY_REMEDIATION.md) | T20 sequence; historical versions and failures, not current-model approval. |
| [Live suite](qa/LIVE_SUITE.md), [regression catalog](qa/REGRESSION_CATALOG.md), [browser snapshot](qa/BROWSER_CASES.md) | Procedures and dated results; not a new execution. |
| [Assessment review, 2026-10-02](requirements/ASSESSMENT_REVIEW_2026-10-02.md) | Historical review predating T22, preserved rather than rewritten. |

Public synthetic fixtures and experiment code under `qa/` preserve reproducibility; prototype folders are not application services. Raw local outputs/traces are ignored. Public summaries explain results without requiring those private files.

## Local-only material and runtime boundary

Study guides, the original assessment PDF, working notes, skills and process records stay under ignored local paths. They are not prerequisites for evaluating a checkout. Secrets, database exports, raw QA artifacts, traces, caches and builds do not belong in Git.

`docs/` is excluded from runtime images; the frontend publishes only its build. `npm run check:web-docs` checks that build, not Git history or every possible secret. Current ignore rules do not erase internal material already present in old commits; see the delivery policy.
